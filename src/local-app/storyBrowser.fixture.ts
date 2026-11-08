import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import type {storyE2eFixture} from './storyE2e.fixture';
const exec=promisify(execFile);
type Story=Awaited<ReturnType<typeof storyE2eFixture>>;

/** Real UI and reverse proxy. Gateway faults never synthesize a successful business result. */
export async function storyBrowser(f:Story,name:string){
 const session='story-'+randomBytes(6).toString('hex'),evidence=process.env.LOOP_STORY_EVIDENCE!;
 const traffic:Array<{command:string;status:number;dropped:boolean}>=[];
 let drop:{command:string;before:boolean}|undefined,vite:ViteDevServer|undefined;
 type ReadKind='session'|'catalog'|'workspace';
 const readGates=new Map<ReadKind,Promise<void>>(),readFailures=new Set<ReadKind>();
 const holdRead=(kind:ReadKind)=>{let release!:()=>void;readGates.set(kind,new Promise<void>(resolve=>{release=resolve;}));return()=>{readGates.delete(kind);release();};};
 const cli=async(...args:string[])=>{
  let stdout:string;
  try{({stdout}=await exec('agent-browser',['--session',session,'--json',...args],{timeout:70000,maxBuffer:4*1024*1024}));}
  catch(error){const e=error as Error&{stdout?:string;stderr?:string};throw Error('Browser '+args[0]+' failed: '+(e.stdout??'')+(e.stderr??''));}
  const result=JSON.parse(stdout);if(!result.success)throw Error(result.error);return result.data;
 };
 const snapshot=async()=>String((await cli('snapshot','-i')).snapshot);
 const evaluate=async(expression:string)=>(await cli('eval','-b',Buffer.from(expression).toString('base64'))).result;
 const wait=async(expression:string)=>cli('wait','--fn',expression);
 const buttonReady=async(name:string)=>wait(`Array.from(document.querySelectorAll('button')).some(b=>(b.getAttribute('aria-label')===${JSON.stringify(name)}||b.textContent.trim()===${JSON.stringify(name)})&&!b.disabled&&b.getBoundingClientRect().width>0&&b.getBoundingClientRect().height>0)`);
 const click=async(name:string)=>{await buttonReady(name);return cli('find','role','button','click','--name',name,'--exact');};
 const doubleClick=async(name:string)=>{await buttonReady(name);const line=(await snapshot()).split('\n').find(line=>line.includes('- button '+JSON.stringify(name)+' '));const ref=line?.match(/ref=(e\d+)/)?.[1];if(!ref)throw Error('Button absent: '+name);return cli('dblclick','@'+ref);};
 const fill=async(label:string,value:string)=>cli('find','label',label,'fill',value,'--exact');
 const capture=async(suffix:string)=>{
  await writeFile(join(evidence,name+'-'+suffix+'.txt'),await snapshot());
  await writeFile(join(evidence,name+'-'+suffix+'-dom.txt'),String(await evaluate('document.body.innerText')));
  await cli('screenshot',join(evidence,name+'-'+suffix+'.png'));
  await writeFile(join(evidence,name+'-traffic.json'),JSON.stringify(traffic,null,2));
 };
 const close=async()=>{try{await cli('close');}finally{await vite?.close();}};
 try{
  vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:join(f.root,'browser-vite-cache'),
   define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},
   plugins:[react(),{name:'story-e2e-real-page',configureServer(server){
    server.middlewares.use('/api',async(req,res)=>{
     try{
      const kind:ReadKind|undefined=req.method!=='GET'?undefined:req.url?.startsWith('/local/session')?'session':req.url?.startsWith('/local/catalog')?'catalog':/\/local\/episodes\/[^/]+\/workspace(?:\?|$)/.test(req.url??'')?'workspace':undefined;
      if(kind){await readGates.get(kind);if(readFailures.has(kind)){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'local_service_unavailable',error:'测试网关：暂时无法读取，请稍后重试。'}));return;}}
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const body=Buffer.concat(chunks),command=body.length?JSON.parse(body.toString()).command??'login':'read';
      if(drop&&drop.command===command&&drop.before){drop=undefined;traffic.push({command,status:0,dropped:true});res.statusCode=503;res.end(JSON.stringify({error:'测试网关中断：本次确认尚未提交，请保留当前工程并恢复。'}));return;}
      const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value&&!['host','connection','content-length','accept-encoding'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
      if(req.method!=='GET')headers.set('Origin',f.origin);
      const upstream=await fetch(f.origin+'/api'+req.url,{method:req.method,headers,...(body.length?{body}:{}),redirect:'manual'});
      const bytes=Buffer.from(await upstream.arrayBuffer()),dropped=drop?.command===command;
      traffic.push({command,status:upstream.status,dropped});
      if(dropped){drop=undefined;res.statusCode=502;res.end(JSON.stringify({error:'测试网关中断：服务端结果回执未能送达，请先核对当前状态。'}));return;}
      res.statusCode=upstream.status;
      upstream.headers.forEach((value,key)=>{if(!['content-length','content-encoding','transfer-encoding','connection'].includes(key))res.setHeader(key,value);});
      res.end(bytes);
     }catch(error){if(!res.destroyed){res.statusCode=502;res.end(JSON.stringify({error:String(error)}));}}
    });
    server.middlewares.use('/__story',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__story','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>雨伞故事 · 隔离 E2E</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});
   }}],server:{host:'127.0.0.1',port:0,proxy:{'/_local-artifact':{target:f.origin,changeOrigin:true}}}});
  await vite.listen();const url=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__story?episode=${f.episode}`;
  await cli('open',url);await cli('wait','--text','登录控制台');
  await fill('邮箱',f.email);await fill('密码',f.password);await click('使用密码登录');
  await cli('wait','--text','末班车前的一把伞');
  return{cli,snapshot,evaluate,wait,click,doubleClick,fill,capture,traffic,url,holdRead,failReads:(kind:ReadKind)=>{readFailures.add(kind);return()=>readFailures.delete(kind);},dropNextResponse:(command:string)=>{drop={command,before:false};},interruptNextRequest:(command:string)=>{drop={command,before:true};},close};
 }catch(error){await close();throw error;}
}
