import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {productionWorkspaceFixture} from '../../../src/local-app/productionWorkspace.fixture';
import {workspaceTestMedia} from '../../../src/local-app/workspaceTestMedia.fixture';
const exec=promisify(execFile),out=resolve('docs/verification/issue-161-workspace-visuals/evidence');await mkdir(out,{recursive:true});const f=await productionWorkspaceFixture();
try{
 let w=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;
 const send=async(name:string,data:Record<string,unknown>)=>{const r=await f.request(name,{workspaceId:w.id,expectedRevision:w.revision,...data});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 for(const c of w.clips)w=await send('matchWorkspaceMaterial',{clipId:c.id,materialRevisionId:f.material});
 w=await send('editWorkspaceStructure',{operation:{kind:'appearance',itemId:w.clips[0].itemId,focusX:17}});
 const original=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8')),imageBytes=await readFile(workspaceTestMedia('still-striped.png'));
 const imported=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'striped.png',mimeType:'image/png',contentBase64:imageBytes.toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});assert.equal(imported.status,200);
 const observations:Record<string,unknown>={sourceVideoSha256:f.files[0].sha256,imageSha256:createHash('sha256').update(imageBytes).digest('hex'),targetItemId:w.clips[0].itemId,untouchedItemId:w.clips[1].itemId};
 const docs:Record<string,any>={before:original};
 for(const usage of ['still','pan-zoom']){
  w=await send('registerWorkspaceVisualCandidate',{targetItemId:w.clips[0].itemId,materialRevisionId:imported.body.id,usage,durationSeconds:2});const candidate=w.visualCandidates[0],prepared=await send('prepareWorkspaceVisualCandidate',{candidateId:candidate.id,durationPolicy:'keep-target',motionPolicy:usage==='pan-zoom'?'replace-motion':'preserve-target'});w=await send('adoptWorkspaceVisualCandidate',{candidateId:candidate.id,adoptionId:prepared.adoptionId});docs[usage]=JSON.parse(await readFile(join(f.assetRoot,w.project.relativePath),'utf8'));assert.deepEqual(docs[usage].timelines[0].items[1],original.timelines[0].items[1]);assert.equal(docs[usage].timelines[0].items[0].transform.x,17);
 }
 for(const [label,project] of Object.entries(docs)){
  const opened=await send('openWorkspaceStudio',{});w=opened.productionWorkspace;const saved=await send('saveWorkspaceStudio',{workspaceRelativePath:opened.workspace.relativePath,projectId:w.project.projectId,expectedWorkspaceSha256:opened.workspace.sha256});w=saved.productionWorkspace;w=await send('closeWorkspaceStudio',{});
  const output=join(out,label+'.mp4'),spec=join(f.root,label+'-render.json');await writeFile(spec,JSON.stringify({openchatcutRoot:f.runtime.root,assetRoot:f.assetRoot,outputPath:output,state:{...project.timelines[0],width:180,height:320},sources:project.assets.map((a:any)=>({relativePath:a.src}))}));await exec(process.execPath,['scripts/openchatcut-render.mjs',spec],{timeout:180000,maxBuffer:4*1024*1024});const {stdout}=await exec('ffprobe',['-v','error','-show_entries','stream=width,height,codec_name,nb_frames:format=duration','-of','json',output]);observations[label]={...JSON.parse(stdout),sha256:createHash('sha256').update(await readFile(output)).digest('hex')};await writeFile(join(out,label+'-project.json'),JSON.stringify(project,null,2));
 }
 const frame=async(label:string,time:string)=>(await exec('ffmpeg',['-v','error','-ss',time,'-i',join(out,label+'.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:2*1024*1024})).stdout;
 const diff=(a:Buffer,b:Buffer)=>a.reduce((sum,n,i)=>sum+Math.abs(n-b[i]),0)/a.length;
 const still=diff(await frame('still','0.2'),await frame('still','1.7')),pan=diff(await frame('pan-zoom','0.2'),await frame('pan-zoom','1.7')),other=diff(await frame('before','2.5'),await frame('pan-zoom','2.5'));assert.ok(still<1);assert.ok(pan>2);assert.ok(other<1);Object.assign(observations,{stillFrameMeanDifference:still,panZoomFrameMeanDifference:pan,untouchedSecondClipMeanDifference:other});await writeFile(join(out,'render-observations.json'),JSON.stringify(observations,null,2));console.log(JSON.stringify(observations));
}finally{await f.close();}
