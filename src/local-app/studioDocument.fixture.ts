// Exercise the SDK's actual HTTP document and ownership boundary, never its JSON backups.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {build} from 'esbuild';
let revisionReader:Promise<{revisionOf:(doc:any)=>string;runProjectMigrations:(doc:any)=>{doc:any}}>|undefined;
export async function editStudioDocument(studioUrl:string,projectId:string,edit:(doc:any)=>void){
 const origin=new URL(studioUrl).origin,headers={'Origin':origin,'Sec-Fetch-Site':'none','Content-Type':'application/json'};
 const entry=await fetch(`${origin}/api/project-store/entry?key=${encodeURIComponent('project:'+projectId)}`,{headers});assert.equal(entry.status,200);
 let {value:doc}=await entry.json();
 revisionReader??=(async()=>{const root=process.env.OPENCHATCUT_ROOT??join(process.cwd(),'.loop-control/local/OpenChatCut');const bundled=await build({stdin:{contents:`export {revisionOf} from ${JSON.stringify(join(root,'src/agent/external-edit-session.ts'))};export {runProjectMigrations} from ${JSON.stringify(join(root,'src/persist/migrations/index.ts'))}`,resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});return(await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64')));})();
 const sdk=await revisionReader;doc=sdk.runProjectMigrations(doc).doc;const expectedRevision=sdk.revisionOf(doc),ownerId='fixture-'+randomUUID();
 const registration=await fetch(origin+'/api/external-agent/register',{method:'POST',headers,body:JSON.stringify({projectId,editorId:ownerId,baseRevision:expectedRevision,tools:[]})});assert.equal(registration.status,200,await registration.clone().text());
 const {ownershipEpoch,registrationCapability}=await registration.json();
 try{
  edit(doc);
  const saved=await fetch(origin+'/api/project-store/project-document/write',{method:'POST',headers,body:JSON.stringify({operation:'project-document-write',key:'project:'+projectId,value:doc,expectedRevision,ownerId,ownershipEpoch})});assert.equal(saved.status,200,await saved.clone().text());const result=await saved.json();assert.equal(result.accepted,true,JSON.stringify(result));return result.value;
 }finally{const released=await fetch(origin+'/api/external-agent/unregister',{method:'POST',headers:{...headers,'X-OpenChatCut-Editor-Registration':registrationCapability},body:JSON.stringify({projectId,editorId:ownerId})});assert.equal(released.status,200);}
}
