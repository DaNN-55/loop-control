import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';
import {createLocalHandler} from './localRoute';
import {csrfFor} from './sessions';
export async function retirementFixture(){
 const f=await embeddedStudioFixture({runtime:{mountPath:'/',wake(){}}});let handler:ReturnType<typeof createLocalHandler>;const server=createServer((req,res)=>handler(req,res));
 try{
 const historyRoot=join(f.root,'legacy-history');await mkdir(historyRoot);const root=await lstat(historyRoot,{bigint:true}),receipts=[];
 for(const kind of ['exclusive','referenced','changed'] as const){
  const content='legacy cleanup '+kind,sha=createHash('sha256').update(content).digest('hex'),path=join(historyRoot,sha);await writeFile(path,content);const s=await lstat(path,{bigint:true}),key=randomUUID(),episode=randomUUID();
  const target={sha,path,root:historyRoot,rootIdentity:[root.dev,root.ino].join(':'),identity:[s.dev,s.ino,s.size,s.mtimeNs].join(':'),bytes:Buffer.byteLength(content)};
  const result={episodeId:episode,title:'旧清理回执 '+kind,path:f.root,stagingPath:f.root,paths:[f.root],stagingPaths:[],cleanupKey:key,cleanupRoot:f.root,cleanupPending:true,cleanupTargets:[],historyCleanupTargets:[target],historyScanRoots:[f.root],historyRemovedPaths:[],summary:{}};
  await f.c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result)VALUES($1,$2,$3,$4)',[f.owner,key,'f'.repeat(64),result]);
  if(kind==='referenced')await f.c.query("INSERT INTO local_identity.history_retained_files(owner_id,logical_path,sha256,bytes,kind,retention_reason)VALUES($1,$2,$3,$4,'fixture','business-dependency')",[f.owner,'retained/'+sha,sha,target.bytes]);
  if(kind==='changed')await writeFile(path,'changed legacy file');
  receipts.push({kind,key,path,content,sha});
 }
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address()as{port:number}).port;handler=createLocalHandler({pool:f.pool,origin,mediaRoot:f.root,historyRoot});
 const post=async(endpoint:string,command:string,data:Record<string,unknown>,token=f.token)=>{const r=await fetch(origin+'/api/local/'+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+token,'X-CSRF-Token':csrfFor(token)},body:JSON.stringify({command,data,idempotencyKey:randomUUID()})});return{status:r.status,body:await r.json()};};
 return{...f,origin,historyRoot,receipts,postCurrent:post,async close(){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await f.close();}};
 }catch(error){server.closeAllConnections();server.close();await f.close();throw error;}
}
