// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAudioFixture} from './workspaceAudio.fixture';
it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('local imported sound stays explicit and keeps its audio and mix through native save and reopen',async()=>{
 const f=await workspaceAudioFixture();try{
 let w=await f.fillVisuals(f.made);
 const send=async(name:string,data={})=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});expect(r.status,name+': '+JSON.stringify(r.body)).toBe(200);w=r.body;};
 const imported=await f.request('importMaterial',{sourceKind:'file',sourcePath:'own-bell.mp3',contentBase64:(await readFile(f.media.sfx)).toString('base64'),materialType:'audio',mimeType:'audio/mpeg',isMainScript:false,materialPurpose:'sound_effect'});expect(imported.status,JSON.stringify(imported.body)).toBe(200);
 const initialSha=w.project.sha256;
 await send('prepareWorkspaceAudio',{kind:'sfx',materialRevisionId:imported.body.id,description:'自有门铃',durationSeconds:.4,anchor:'shot',shotId:w.clips[0].shotId,offsetSeconds:.2});
 const preparation=w.audio.preparations[0];expect(preparation.taskId).toBeNull();expect(preparation.adoptedItemId).toBeNull();expect(w.project.sha256).toBe(initialSha);expect(w.audio.mix.sounds).toHaveLength(0);
 await send('adoptWorkspaceAudio',{preparationId:preparation.id});const itemId=w.audio.mix.sounds[0].itemId;
 await send('mixWorkspaceAudio',{edit:{kind:'sound',workspaceId:w.id,itemId,gainDb:-17,duckDepthDb:3}});
 const expectedMix=structuredClone(w.audio.mix.sounds),expectedSource={relativePath:preparation.relativePath,sha256:preparation.sha256,fileSize:preparation.fileSize};
 // Slow only the child runtime's graceful signal handling; all SDK/HTTP/files stay real.
 const launcher=join(f.root,'delayed-studio-node.mjs'),shutdownLog=join(f.root,'studio-shutdown.jsonl');
 await writeFile(launcher,`#!${process.execPath}\nimport {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';if(process.argv[2]==='--version')console.log(process.version);else{const child=spawn(process.execPath,process.argv.slice(2),{stdio:'inherit',env:process.env});let stopping=false;process.on('SIGTERM',()=>{if(stopping)return;stopping=true;appendFileSync(${JSON.stringify(shutdownLog)},JSON.stringify({event:'signal',at:Date.now()})+'\\n');setTimeout(()=>child.kill('SIGTERM'),3100);});child.once('exit',(code,signal)=>{if(stopping)appendFileSync(${JSON.stringify(shutdownLog)},JSON.stringify({event:'exit',at:Date.now(),code,signal})+'\\n');process.exit(code??143);});}`);
 await chmod(launcher,0o700);f.runtime.nodePath=launcher;
 const opened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(opened.status,JSON.stringify(opened.body)).toBe(200);w=opened.body.productionWorkspace;
 const saved=await f.request('saveWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision,workspaceRelativePath:opened.body.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.body.workspace.sha256});expect(saved.status,JSON.stringify(saved.body)).toBe(200);w=saved.body.productionWorkspace;await send('closeWorkspaceStudio');
 await f.restart();w=await f.read();expect(w.audio.mix.sounds).toEqual(expectedMix);expect(w.audio.preparations[0]).toMatchObject(expectedSource);
 const reopened=await f.request('openWorkspaceStudio',{workspaceId:w.id,expectedRevision:w.revision});expect(reopened.status,JSON.stringify(reopened.body)).toBe(200);w=reopened.body.productionWorkspace;await send('closeWorkspaceStudio');
 expect(w.audio.mix.sounds).toEqual(expectedMix);expect(w.audio.preparations[0]).toMatchObject(expectedSource);
 const project=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));expect(project.timelines.flatMap((t:any)=>t.items).filter((i:any)=>i.id===itemId)).toHaveLength(1);
 const shutdown=(await readFile(shutdownLog,'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(shutdown.map(event=>event.event)).toEqual(['signal','exit','signal','exit']);for(let i=0;i<shutdown.length;i+=2)expect(shutdown[i+1].at-shutdown[i].at).toBeGreaterThanOrEqual(3000);
 if(process.env.LOOP_SOUND_EVIDENCE)await writeFile(join(process.env.LOOP_SOUND_EVIDENCE,'imported-sound-retention.json'),JSON.stringify({source:expectedSource,mix:expectedMix,shutdown,supplierCalls:0},null,2));
 expect(await readFile(f.audioSubmissions,'utf8').catch(()=>'' )).toBe('');
 }finally{await f.close();}
},180000);
