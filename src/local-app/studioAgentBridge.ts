import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {SecretStore} from './connectionPorts.js';
import {ownerTransaction} from './ownerTransaction.js';
import {resolveProductionSelection} from './productionSelection.js';
import {ownedConnectionVersion} from '../worker/localConnection.js';
import {registeredAdapters} from '../worker/registeredAdapters.js';
import type {ProductionSelection} from '../productionSelection.js';

interface Lease {ownerId:string;episodeId:string;expires:number;choices:ProductionSelection[]}
/** Native SDK receives a revocable local capability, never an upstream credential.
 * Each send rechecks the Owner's current connection, enabled model and live proof. */
export class StudioAgentBridge {
 private leases=new Map<string,Lease>();
 private server=createServer((request,response)=>{void this.request(request,response);});
 private origin='';
 constructor(private pool:Pool,private store:SecretStore,private transport:typeof fetch=fetch){}
 async start(){await new Promise<void>((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});const address=this.server.address();if(!address||typeof address==='string')throw Error('Agent连接未就绪。');this.origin=`http://127.0.0.1:${address.port}`;return this;}
 async environment(c:PoolClient,episodeId:string):Promise<NodeJS.ProcessEnv>{
  if(this.store.mode!=='keychain')return {};
  const ownerId=(await c.query("SELECT current_setting('loop.owner_id') id")).rows[0].id;
  const rows=(await c.query('SELECT id,provider,adapter FROM public.list_external_connection_versions(NULL) WHERE is_current AND revoked_at IS NULL')).rows;
  const choices:ProductionSelection[]=[];
  for(const row of rows){
   if(!['openai_responses','deepseek_responses'].includes(row.adapter))continue;
   const choice=registeredAdapters.productionChoices().find(x=>x.capability==='language_model'&&x.provider===row.provider&&x.adapter===row.adapter);
   for(const model of choice?.models??[]){
    try{const resolved=await resolveProductionSelection(c,{capability:'language_model',provider:row.provider,adapter:row.adapter,model,connectionVersionId:row.id},'language_model');choices.push(resolved.selection);}catch{/* Unavailable or disabled models are not offered. */}
   }
  }
  // The SDK has one credential slot per vendor. Prefer the first current usable
  // connection, retaining all enabled models belonging to that same connection.
  const selected=choices.filter((value,index,all)=>all.find(x=>x.provider===value.provider)?.connectionVersionId===value.connectionVersionId&&all.findIndex(x=>x.provider===value.provider&&x.model===value.model)===index);
  if(!selected.length)return {};
  let entry=[...this.leases].find(([,lease])=>lease.ownerId===ownerId&&lease.episodeId===episodeId&&lease.expires>Date.now());
  if(!entry){entry=[randomBytes(32).toString('hex'),{ownerId,episodeId,expires:Date.now()+8*60*60*1000,choices:selected}];this.leases.set(...entry);}
  entry[1].choices=selected;
  const models:Record<string,string[]>={},environment:NodeJS.ProcessEnv={LLM_PROVIDER:selected.find(x=>x.provider==='openai')?.provider??selected[0].provider,LLM_OPENAI_API_MODE:'responses'};
  for(const value of selected){const name=value.provider.toUpperCase();(models[value.provider]??=[]).push(value.model!);environment[`LLM_${name}_API_KEY`]=entry[0];environment[`LLM_${name}_BASE_URL`]=`${this.origin}/${value.provider}`;environment[`LLM_${name}_MODEL`]??=value.model;}
  environment.LOOP_STUDIO_AGENT_MODELS=JSON.stringify(models);return environment;
 }
 revoke(episodeId:string){for(const [key,value] of this.leases)if(value.episodeId===episodeId)this.leases.delete(key);}
 async close(){this.leases.clear();this.server.closeAllConnections();await new Promise<void>(resolve=>this.server.close(()=>resolve()));}
 private async request(request:IncomingMessage,response:ServerResponse){
  try{
   const token=request.headers.authorization?.replace(/^Bearer /,''),lease=token?this.leases.get(token):undefined;
   if(!lease||lease.expires<Date.now()||request.method!=='POST'||request.headers.host!==new URL(this.origin).host)throw Error();
   // The native /llm proxy retains its editor's Origin header. Only loopback
   // editor origins may accompany the unguessable server-side capability.
   if(request.headers.origin&&!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(request.headers.origin))throw Error();
   const path=request.url??'',match=/^\/(openai|deepseek)\/(responses|chat\/completions)$/.exec(path);
   if(!match||match[1]==='deepseek'&&match[2]!=='chat/completions')throw Error();
   let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>16*1024*1024)throw Error();chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString()),choice=lease.choices.find(x=>x.provider===match[1]&&x.model===body.model);if(!choice)throw Error();
   const prepared=await ownerTransaction(this.pool,lease.ownerId,false,async c=>{
    const visible=(await c.query("SELECT e.id FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin r WHERE r.episode_id=e.id)",[lease.episodeId,lease.ownerId])).rowCount;if(!visible)throw Error();
    await resolveProductionSelection(c,choice,'language_model');const version=await ownedConnectionVersion(c,choice.connectionVersionId!);if(!version?.secret_ref)throw Error();
    const expected=choice.provider==='openai'?'https://api.openai.com/v1':'https://api.deepseek.com';if(version.endpoint.replace(/\/$/,'')!==expected)throw Error();
    return {url:`${expected}/${match[2]}`,secret:await this.store.get(version.secret_ref)};
   });
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000);const abort=()=>controller.abort();response.once('close',abort);
   try{
    const upstream=await this.transport(prepared.url,{method:'POST',headers:{Authorization:`Bearer ${prepared.secret}`,'Content-Type':'application/json'},body:JSON.stringify({...body,...(choice.provider==='openai'?{store:false}:{})}),redirect:'manual',signal:controller.signal});
    if(!upstream.ok){await upstream.body?.cancel();response.writeHead(upstream.status>=400&&upstream.status<=599?upstream.status:502,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'模型请求未完成，请检查连接或模型状态。'}));return;}
    response.writeHead(200,{'Content-Type':upstream.headers.get('content-type')??'application/json','Cache-Control':'no-store'});
    const reader=upstream.body?.getReader();
    try{while(reader&&!controller.signal.aborted){const part=await reader.read();if(part.done)break;if(!response.write(part.value))await new Promise<void>(resolve=>{const done=()=>{response.removeListener('drain',done);controller.signal.removeEventListener('abort',done);resolve();};response.once('drain',done);controller.signal.addEventListener('abort',done,{once:true});});}response.end();}finally{await reader?.cancel().catch(()=>{});}
   }finally{clearTimeout(timeout);response.removeListener('close',abort);}
  }catch{if(!response.headersSent){response.writeHead(403,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'现有模型连接不可用，请返回工作台检查连接后重新打开剪辑台。'}));}else response.destroy();}
 }
}
