import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import type {RuntimeLogEntry,RuntimeLogReport} from '../observability/logTypes.js';

const readLimit=1024*1024,maxEntries=200,maxRecord=8192;
export function redactRuntimeLog(text:string){
 return text.replace(/\x1b\[[0-9;]*m/g,'')
 .replace(/\bBearer\s+[^\s"',}\]]+/gi,'Bearer [已脱敏]')
 .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie|contentBase64|scriptContent|prompt|body)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi,'$1[已脱敏]')
 .replace(/\b(?:sk|sk-proj|sk-ant|sess)[-_][A-Za-z0-9_-]{12,}\b/g,'[已脱敏]')
 .replace(/https?:\/\/[^\s"'<>]+/gi,value=>{try{const u=new URL(value);u.username='';u.password='';u.search='';u.hash='';return u.toString();}catch{return '[链接已脱敏]';}})
 .replace(/\/(?:Users|home)\/[^\s"'():]+?\/node_modules\//g,'[项目目录]/node_modules/')
 .replace(/(?:\/Users|\/home)\/[^\s"'():]+/g,'[本机路径]');
}
function entry(line:string,offset:number,file:string):RuntimeLogEntry|null{
 const clean=line.replace(/\x1b\[[0-9;]*m/g,'');let json:Record<string,unknown>|null=null;
 try{const parsed:unknown=JSON.parse(clean);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))json=parsed as Record<string,unknown>;}catch{/* Legacy text is expected. */}
 const level=String(json?.level??'').toUpperCase();
 const textError=/(?:^|\s)(?:[A-Za-z]*Error:|error:)|\[ERROR\]|Internal server error:/i.test(clean);
 if(!['INFO','WARN','ERROR'].includes(level)&&!textError)return null;
 const safe=(key:string)=>typeof json?.[key]==='string'?redactRuntimeLog(json[key] as string).slice(0,512):null;
 const message=redactRuntimeLog(String(json?.message??clean)).slice(0,2048);
 const stamp=safe('timestamp')??safe('time'),occurredAt=stamp&&/^\d{4}-\d\d-\d\dT/.test(stamp)&&Number.isFinite(Date.parse(stamp))?new Date(stamp).toISOString():null;
 const legacyClock=/^(\d{1,2}):(\d\d):(\d\d)(?: (AM|PM))?\b/.exec(clean);
 const hour=legacyClock?Number(legacyClock[1]):0;
 const clock=stamp&&/^\d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(stamp)?stamp:legacyClock&&hour<=23&&Number(legacyClock[2])<60&&Number(legacyClock[3])<60?`${String(legacyClock[4]?(hour%12)+(legacyClock[4]==='PM'?12:0):hour).padStart(2,'0')}:${legacyClock[2]}:${legacyClock[3]}`:null;
 const severity=(['INFO','WARN','ERROR'].includes(level)?level:'ERROR') as RuntimeLogEntry['level'];
 const database=/Connection terminated unexpectedly/.test(message);
 const allowed=['timestamp','time','level','episodeId','episodeName','operationId','requestId','source','message','taskId','attempt','errorCode','httpStatus','durationMs','fileSize','sourcePath','phase','method','route','errorName','stackFrames','runtimeReleaseId'];
 const raw=(json?redactRuntimeLog(JSON.stringify(Object.fromEntries(allowed.filter(key=>Object.hasOwn(json!,key)&&['string','number','boolean'].includes(typeof json![key])).map(key=>[key,json![key]])),null,2)):message).slice(0,maxRecord);
 return{id:createHash('sha256').update(file+':'+offset+':'+clean).digest('hex').slice(0,24),level:severity,occurredAt,time:clock,episodeId:safe('episodeId'),episodeName:safe('episodeName'),operationId:safe('operationId'),requestId:safe('requestId'),source:safe('source')??'运行服务',message,raw,sourceFile:basename(file),line:offset,
 explanation:json?.phase==='started'?{what:message,result:'请求已进入本机处理，尚无完成回执。'}:json?.phase==='interrupted'?{what:message,result:'响应连接提前关闭，客户端是否收到结果未知；请先核对原操作。'}:json?.phase==='responded'?{what:message,result:severity==='INFO'?'本机接口已返回成功响应；这不代表后台任务或整次制作已完成。':'本机接口未返回成功响应；是否已保存或创建任务须另行核对。'}:database?{what:'连接意外中断。',result:'这条连接已断开；日志未说明哪些请求或生产单受到影响。',reason:'日志未记录具体中断原因。',suggestion:'若再次出现，检查相关服务与连接情况，并核对原操作结果。'}:{what:message,result:severity==='ERROR'?'记录到异常；业务影响和恢复结果请以相关任务或后续日志为准。':'仅表示本条记录所述事件，不能据此判断整次制作已完成。'}};
}
export async function readRuntimeLogs(files:string[]):Promise<RuntimeLogReport>{
 const entries:RuntimeLogEntry[]=[];let truncated=false,sourceAvailable=false;
 for(const file of [...new Set(files)]){
  let handle;
  try{
   handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile())throw Error('Not a log file');sourceAvailable=true;
   const start=Math.max(0,stat.size-readLimit),buffer=Buffer.alloc(Math.min(stat.size,readLimit));const {bytesRead}=await handle.read(buffer,0,buffer.length,start);let text=buffer.subarray(0,bytesRead).toString('utf8');
   if(start){truncated=true;text=text.slice(text.indexOf('\n')+1);}
   const lines=text.split(/\r?\n/);let current:RuntimeLogEntry|null=null;
   for(let i=0;i<lines.length;i++){
    const line=lines[i];const next=entry(line,i+1,file);
    if(next){current=next;if(start)current.line=null;entries.push(current);}
    else if(current&&/^\s+at |^Emitted 'error' event/.test(line)&&current.raw.length<maxRecord)current.raw=(current.raw+'\n'+redactRuntimeLog(line)).slice(0,maxRecord);
    else current=null;
   }
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('日志文件暂不可读，请检查日志位置与权限。');}
  finally{await handle?.close();}
 }
 for(const item of entries)if(/Connection terminated unexpectedly/.test(item.message)&&item.raw.includes('node_modules/pg/')){item.source='数据库连接';item.explanation.what='PostgreSQL 数据库连接意外中断。';}
 return{observedAt:new Date().toISOString(),entries:entries.slice(-maxEntries).reverse(),truncated:truncated||entries.length>maxEntries,sourceAvailable,maxEntries};
}
