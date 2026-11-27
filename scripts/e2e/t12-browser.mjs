// External browser side of the T12 file handshake. Business mutations are UI actions.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';

const args=process.argv.slice(2),evidence=resolve(args[args.indexOf('--evidence')+1]??'');
if(args.length!==2||args[0]!=='--evidence')throw Error('Usage: node scripts/e2e/t12-browser.mjs --evidence <private-case-directory>');
const config=JSON.parse(await readFile(join(evidence,'browser.json'),'utf8'));
const {runId,kind,session,url}=config;
if(config.version!=='t12-handshake/v1'||!['series','unassigned'].includes(kind)||!session||!runId||new URL(url).hostname!=='127.0.0.1')throw Error('Invalid T12 browser invitation');
const exec=promisify(execFile),startedAt=Date.now(),stages=[];
let episode,phase='login';
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const redact=value=>String(value).replaceAll(config.password,'<REDACTED>');
const cli=async(...commands)=>{
 try{
  const {stdout}=await exec('agent-browser',['--session',session,'--json',...commands],{timeout:45000,maxBuffer:4*1024*1024});
  const result=JSON.parse(stdout);if(!result.success)throw Error(result.error);return result.data;
 }catch(error){throw Error(`Browser ${commands[0]} failed: ${redact(error.stdout??error.message)}`);}
};
const evaluate=async(code)=>(await cli('eval','-b',Buffer.from(code).toString('base64'))).result;
const snapshot=async()=>String((await cli('snapshot','-i')).snapshot);
async function signal(name,data={}){
 const body={version:'t12-handshake/v1',runId,kind,session,episodeId:episode,...data},temporary=join(evidence,name+'.'+randomUUID()+'.tmp');
 await writeFile(temporary,JSON.stringify(body,null,2)+'\n',{mode:0o600});await rename(temporary,join(evidence,name));
}
async function checkFailure(){
 try{const failure=JSON.parse(await readFile(join(evidence,'browser-failed.json'),'utf8'));throw Error('Fixture failed: '+failure.error);}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function waitSignal(name,timeout=180000,predicate=()=>true){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){await checkFailure();try{const value=JSON.parse(await readFile(join(evidence,name),'utf8'));assert(value.version==='t12-handshake/v1'&&value.runId===runId&&value.kind===kind&&value.session===session,'Foreign or stale '+name);if(episode)assert(value.episodeId===episode,'Wrong order in '+name);if(predicate(value))return value;}catch(error){if(error.code!=='ENOENT')throw error;}await pause(200);}
 throw Error('Timed out waiting for '+name);
}
async function waitFor(code,label,timeout=60000){
 const deadline=Date.now()+timeout;while(Date.now()<deadline){await checkFailure();if(await evaluate(code))return;await pause(200);}throw Error('Timed out: '+label);
}
async function click(name){
 await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>(b.getAttribute('aria-label')===${JSON.stringify(name)}||b.textContent.trim()===${JSON.stringify(name)})&&!b.disabled&&b.getBoundingClientRect().width>0&&b.getBoundingClientRect().height>0)`,name);
 await cli('find','role','button','click','--name',name,'--exact');
}
const fill=(name,value)=>cli('find','label',name,'fill',value,'--exact');
async function capture(name){
 await writeFile(join(evidence,name+'.txt'),await snapshot());
 await cli('screenshot',join(evidence,name+'.png'),'--full');
}
async function stage(name){phase=name;stages.push({stage:name,at:new Date().toISOString()});await writeFile(join(evidence,'browser-progress.json'),JSON.stringify(stages,null,2));process.stdout.write(`T12 ${kind}: ${name}\n`);}
async function observeRequests(){
 await evaluate(`(()=>{if(window.__t12Traffic)return;window.__t12Traffic=[];const original=window.fetch.bind(window);window.fetch=async(...args)=>{let command;try{command=JSON.parse(args[1]?.body||'{}').command;}catch{}const response=await original(...args);if(command){let id;try{id=(await response.clone().json()).id;}catch{}window.__t12Traffic.push({command,status:response.status,id});}return response;};})()`);
}
async function openOrder(step='preparation'){
 const page=new URL(url);page.searchParams.set('episode',episode);page.searchParams.set('step',step);await cli('open',page.href);
 await waitFor("!!document.querySelector('[aria-label=主导航]')",'authenticated console');await observeRequests();
}
async function openEditor(shotId){
 // The active storyboard shot is selected automatically when Studio connects.
 const shotButton=`button[title=${JSON.stringify(shotId)}][aria-pressed]`;
 await waitFor(`!!document.querySelector(${JSON.stringify(shotButton)})`,'storyboard loaded');
 await cli('click',shotButton);
 await click('进入剪辑工作台');await waitFor("!!document.querySelector('iframe')&&!document.querySelector('iframe').hasAttribute('inert')",'editable SDK iframe');
}
try{
 await mkdir(evidence,{recursive:true});await stage('login');await cli('open',url);await cli('set','viewport','1440','1000');
 await cli('wait','--text','登录控制台');await fill('邮箱',config.email);await fill('密码',config.password);await click('使用密码登录');
 await waitFor("!!document.querySelector('[aria-label=主导航]')",'login');await observeRequests();
 await click('生产单');await click('新建生产单');
  await cli('find','role','menuitem','click','--name','新建生产单','--exact');
  await cli('wait','form[aria-label="新建生产单"]');
 await cli('select','form[aria-label="新建生产单"] select:not([aria-label="系列版本"])',config.accountId);
 await cli('select','[aria-label="系列版本"]',config.seriesVersionId??'');
 await fill('工作标题（可留空）',`T12 ${kind} 正式生产单 [100%_#?]✨`);await capture('01-create-form');await click('创建生产单');
 await waitFor("window.__t12Traffic?.some(r=>r.command==='create'&&r.status===200&&r.id)",'UI create response');
 episode=await evaluate("window.__t12Traffic.find(r=>r.command==='create'&&r.status===200).id");assert(/^[0-9a-f-]{36}$/.test(episode),'Invalid created order');
 await signal('created.json');await capture('02-created');await stage('waiting-for-prepared');
 const prepared=await waitSignal('prepared.json',300000);assert(prepared.workspace?.clips?.length,'No prepared shots');const shot=prepared.workspace.clips[0];
 await openOrder();await waitFor("!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='进入剪辑工作台')",'prepared UI');
 for(const width of [1440,390]){await cli('set','viewport',String(width),'1000');assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Preparation horizontal overflow');await capture('03-prepared-'+width);}
 await cli('set','viewport','1440','1000');await stage('native-edit');await openEditor(shot.shotId);
 await signal('native-opened.json',{ready:true,projectId:prepared.projectId});await waitSignal('native-candidate-checked.json');
 await click('保存并返回分镜台');await waitFor("!document.querySelector('iframe')",'SDK save and close');
 await stage('restart');const token=randomUUID();await signal('restart-request.json',{token});await waitSignal('restarted.json',90000,value=>value.token===token&&value.nativeTransformX===1);
 await openOrder();await openEditor(shot.shotId);await capture('05-native-reopened');
 await click('保存并返回分镜台');await waitFor("!document.querySelector('iframe')",'second SDK close');
 await stage('editable-restore');await signal('backup-point.json',{ready:true});await waitSignal('backup-done.json',360000);
 await openOrder('delivery');await click('生成成片');await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='确认并完成'&&!b.disabled)",'actual export',315000);await capture('06-exported');
 await click('确认并完成');await stage('delivery');
 const finalLink=`[aria-label="交付操作"] a[download]`;
 const haveFinal=`Array.from(document.querySelectorAll(${JSON.stringify(finalLink)})).some(a=>a.textContent.trim()==='下载视频')`;
 await waitFor(haveFinal,'verified delivery',120000);await cli('reload');await waitFor(haveFinal,'verified delivery after reload');
 const downloads=await evaluate(`(async()=>{const a=[...document.querySelectorAll(${JSON.stringify(finalLink)})].find(a=>a.textContent.trim()==='下载视频');const url=new URL(a.href),response=await fetch(url),bytes=await response.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),sha256=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');return [{label:a.textContent.trim(),status:response.status,size:bytes.byteLength,sha256,expectedSha256:url.searchParams.get('sha256'),episodeId:url.searchParams.get('episode')}];})()`);
 const [mp4]=downloads;assert(mp4.status===200&&mp4.size>0&&mp4.episodeId===episode&&mp4.expectedSha256&&mp4.sha256===mp4.expectedSha256,'Invalid downloaded final MP4');
 await writeFile(join(evidence,'browser-downloads.json'),JSON.stringify(downloads,null,2));
 await waitFor("document.querySelector('video[aria-label=最终导出视频]')?.readyState>=2",'playable export');
 const playbackStart=await evaluate("(async()=>{const video=document.querySelector('video[aria-label=最终导出视频]');video.muted=true;await video.play();return video.currentTime;})()");
 await waitFor(`document.querySelector('video[aria-label=最终导出视频]').currentTime>${Number(playbackStart)+0.15}`,'video playback');
 const playback=await evaluate("(()=>{const video=document.querySelector('video[aria-label=最终导出视频]'),result={time:video.currentTime,duration:video.duration,frames:video.getVideoPlaybackQuality().totalVideoFrames};video.pause();return result;})()");assert(playback.frames>0,'No decoded video frames');
 await writeFile(join(evidence,'browser-playback.json'),JSON.stringify(playback,null,2));
 for(const width of [1440,390]){await cli('set','viewport',String(width),'1000');assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Delivery horizontal overflow');
  const alerts=await evaluate(`Array.from(document.querySelectorAll('[role="alert"]')).filter(element=>element.getClientRects().length).map(element=>element.textContent.trim()).filter(Boolean)`);
  assert(alerts.length===0,'Delivered page contains alerts: '+alerts.join('; '));await capture('07-delivered-'+width);
 }
 await stage('browser-complete');await signal('browser-done.json',{passed:true,nativeTransformX:1,restartToken:token,downloadCount:downloads.length,playbackFrames:playback.frames,elapsedMs:Date.now()-startedAt});
}catch(error){
 const message=redact(error.stack??error);await signal('browser-failed.json',{error:message,phase});
 for(const [command,file]of [['snapshot','browser-failure.txt'],['errors','browser-errors.txt'],['console','browser-console.txt']])try{const value=command==='snapshot'?await snapshot():JSON.stringify(await cli(command));await writeFile(join(evidence,file),redact(value));}catch{}
 try{await cli('screenshot',join(evidence,'browser-failure.png'),'--full');}catch{}
 process.stderr.write(`T12 ${kind} ${phase}: ${redact(error.message)}\n`);process.exitCode=1;
}finally{await cli('close').catch(()=>{});}
