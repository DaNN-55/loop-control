// Copied by run.mjs into the isolated snapshot's src/local-app, never a product entry.
// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdir,readFile,readdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {storyE2eFixture} from './storyE2e.fixture';
import {storyBrowser} from './storyBrowser.fixture';
import {storyProcess} from './storyProcess.fixture';

it.skipIf(process.env.LOOP_STORY_E2E!=='1')('T01–T08 isolated UI audit: real page, HTTP, PG, Worker, native SDK and files',async()=>{
 const evidence=process.env.LOOP_STORY_EVIDENCE!,control=join(evidence,'private-control');await mkdir(control,{mode:0o700});
 const f=await storyE2eFixture();let browser:Awaited<ReturnType<typeof storyBrowser>>|undefined,processFixture:Awaited<ReturnType<typeof storyProcess>>|undefined;
 const completed=new Set<string>();let finished=false;
 try{
  browser=await storyBrowser(f,'audit');
  const b=browser as typeof browser&{session:string};
  const manifest={session:b.session,url:b.url,origin:f.origin,episode:f.episode,owner:f.owner,account:f.account,series:f.series,root:f.root,assetRoot:f.assetRoot,files:f.files,materials:f.materials,selections:f.selections,control,evidence,source:process.cwd(),sdk:process.env.OPENCHATCUT_ROOT};
  await writeFile(join(evidence,'audit-context.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  console.log('AUDIT_READY '+join(evidence,'audit-context.json'));
  while(!finished){
   const requests=(await readdir(control)).filter(n=>n.endsWith('.request.json')).sort();
   for(const file of requests){
    const path=join(control,file),request=JSON.parse(await readFile(path,'utf8'));await rename(path,path+'.processing');
    let value:unknown;
    try{
     switch(request.action){
      case 'read':value=await f.read();break;
      case 'fill':value=await f.fill();break;
      case 'send':await f.read();value=await f.send(request.data.command,request.data.data??{},request.data.key);break;
      case 'raw':value=await f.post(request.data.endpoint??'episode-commands',request.data.command,{episodeId:f.episode,...request.data.data},request.data.key);break;
      case 'execute':value=await f.execute(request.data.taskId);break;
      case 'providerMode':if(!['success','unknown','reject','poll-fail'].includes(request.data.mode))throw Error('Unsupported controlled mode');await writeFile(f.mode,request.data.mode);value={mode:request.data.mode};break;
      case 'submissions':try{value=(await readFile(f.submissions,'utf8')).trim().split('\n').filter(Boolean).map(line=>{const x=JSON.parse(line);return{url:x.url,action:x.action};});}catch{value=[];}break;
      case 'restart':await f.restart();value=await f.read();break;
      case 'mount':if(request.data.mounted)await f.volume.remount();else await f.volume.unmount();value={mounted:request.data.mounted};break;
      case 'startProcess':processFixture??=await storyProcess(f);value=await processFixture.launch(request.data.fault??'none');break;
      case 'stopProcess':await processFixture?.stop();value={stopped:true};break;
      case 'native':await b.visualTools();value={opened:true};break;
      case 'browser':value=await b.cli(...request.data.args);break;
      case 'capture':await b.capture(request.data.name);value={captured:request.data.name};break;
      case 'query':value=(await f.c.query(request.data.sql,request.data.values??[])).rows;break;
      case 'mark':if(!/^T0[1-8]$/.test(request.data.id))throw Error('Unknown audit group');await writeFile(join(evidence,request.data.id+'.json'),JSON.stringify(request.data,null,2));completed.add(request.data.id);value={recorded:request.data.id};break;
      case 'finish':expect([...completed].sort()).toEqual(['T01','T02','T03','T04','T05','T06','T07','T08']);finished=true;value={complete:[...completed].sort(),paidCalls:0};break;
      default:throw Error('Unsupported audit action');
     }
     await writeFile(join(control,file.replace('.request.json','.response.json')),JSON.stringify({ok:true,value},null,2));
    }catch(error){await writeFile(join(control,file.replace('.request.json','.response.json')),JSON.stringify({ok:false,error:String(error instanceof Error?error.stack:error)},null,2));}
   }
   if(!finished)await new Promise(resolve=>setTimeout(resolve,100));
  }
 }finally{await processFixture?.close();await browser?.close();await f.close();}
},3600000);
