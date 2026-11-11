import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {resolve} from 'node:path';
const run=promisify(execFile),folder=resolve('docs/verification/state-machines-78-20261111'),scratch=resolve('.scratch/state-machines-78');
const b=async(...args)=>(await run('agent-browser',['--session','state78',...args],{maxBuffer:4*1024*1024})).stdout;
const ev=async(code)=>JSON.parse(await b('eval',code));
const state=()=>ev('(async()=>await(await fetch("/__state")).json())()');
const call=path=>ev(`(async()=>{await fetch(${JSON.stringify(path)});return true;})()`);
const shot=name=>b('screenshot',folder+'/'+name+'.png');const results={};
await b('set','viewport','1440','1000');await b('open','http://127.0.0.1:5198/__fixture?view=storage');await b('wait','[aria-label="文件复制进度"]');
await ev('Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});document.dispatchEvent(new Event("visibilitychange"));true');
const hiddenReads=(await state()).reads;await b('wait','1100');assert.equal((await state()).reads,hiddenReads);
await ev('Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});document.dispatchEvent(new Event("visibilitychange"));true');
assert((await state()).reads>hiddenReads);results.storageVisibility={hiddenReads,returnedReads:(await state()).reads,method:'instrumented visibility event on real component'};
await shot('storage-wide');await b('set','viewport','390','900');await ev('document.documentElement.dataset.theme="dark"');assert.equal(await ev('document.documentElement.scrollWidth'),390);await shot('storage-mobile-dark');
await call('/__complete');await b('wait','--text','媒体根迁移完成');assert.equal(await ev('document.querySelectorAll("progress").length'),0);await b('find','role','button','click','--name','关闭验收面板');await b('find','role','button','click','--name','重开验收面板');await b('wait','--text','/fixture/new');results.storageReopen=true;
for(const view of ['visual','shelf']){
 await b('set','viewport','1440','1000');await b('open','http://127.0.0.1:5198/__fixture?view='+view);
 const input=view==='shelf'?'上传制作素材':'上传图片素材';
 if(view==='shelf'){await b('wait','--text','本期素材 · 0');await b('find','role','button','click','--name','本期素材 · 0');}else await b('wait','[aria-label="镜头图片与视频"]');
 await b('upload',`[aria-label="${input}"]`,scratch+'/imported.png',scratch+'/bad.png');
 if(view==='visual'){assert.equal(await ev('document.querySelector(".workspace-upload-actions button").disabled'),true);}
 await call('/__release');await b('wait','--fn','[...document.querySelectorAll("button")].some(e=>e.textContent.includes("放弃未完成项")&&!e.disabled)');
 await shot(view+'-failed-wide');await b('set','viewport','390','1000');await ev('document.documentElement.dataset.theme="dark"');assert.equal(await ev('document.documentElement.scrollWidth'),390);await shot(view+'-failed-mobile-dark');
 await b('find','role','button','click','--name','放弃未完成项');await b('wait','--fn','![...document.querySelectorAll("button")].some(e=>e.textContent.includes("重试未完成项"))');
 await b('find','role','button','click','--name','关闭验收面板');await b('find','role','button','click','--name','重开验收面板');
 if(view==='visual'){
  await b('find','role','button','click','--name','AI 生成');await b('find','role','button','click','--name','添加参考图');await b('wait','[aria-label="参考图 imported.png"]');assert.equal(await ev('[...document.querySelectorAll("input")].some(e=>e.getAttribute("aria-label")==="参考图 bad.png")'),false);await shot('visual-retained-mobile-dark');await b('find','role','button','click','--name','关闭参考图选择');await b('find','role','button','click','--name','上传素材');
 }else {await b('wait','--text','本期素材 · 1');await b('find','role','button','click','--name','本期素材 · 1');}
 await b('upload',`[aria-label="${input}"]`,scratch+'/new.png');
 await b('wait','--fn',view==='shelf'?'[...document.querySelectorAll("button")].some(e=>e.textContent==="本期素材 · 2")':'[...document.querySelectorAll("button")].filter(e=>(e.getAttribute("aria-label")||"").startsWith("预览图片候选")).length===1');
 const stats=await state();assert.deepEqual(stats.commands.filter(c=>c.command==='importMaterial').map(c=>c.data.sourcePath),['imported.png','bad.png','new.png']);
 assert.deepEqual(stats.commands.filter(c=>c.command==='registerWorkspaceVisualCandidate').map(c=>c.data.materialRevisionId),view==='visual'?['imported.png','new.png']:[]);results[view]={imports:3,newBatch:true,retainedImport:true,noAbandonedRetry:true};
}
results.errors=await b('errors');assert(!results.errors.trim());await writeFile(folder+'/browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
