import {readFile,writeFile} from 'node:fs/promises';
import {runtimeContext,readSettings} from '../../../scripts/runtime/environment.mjs';
import {keychainState} from '../../../scripts/runtime/keychain.mjs';
import {configuredKeychainStore} from '../../../dist/local-app/local-app/keychainStore.js';
import {bailianCredential} from '../../../dist/local-app/worker/wanVideoProvider.js';
const c=runtimeContext(),d=readSettings(),ledger=JSON.parse(await readFile(new URL('./live-results.json',import.meta.url),'utf8'));
const ref=c.sql("select b.secret_ref from local_identity.connection_bindings b join public.external_connections cn on cn.current_version_id=b.version_id join local_identity.input_episodes i on i.owner_id=cn.created_by where i.episode_id='a5c27db4-3c4c-434d-b43a-402e13016fbe' and cn.provider='bailian'");
const credential=bailianCredential(await configuredKeychainStore(d.connections.keychain,()=>keychainState('unlock')).get(ref)),results=[];
for(const r of ledger.results.filter(r=>r.provider==='bailian'&&r.providerTaskId)){
 const response=await fetch(credential.origin+'/api/v1/tasks/'+r.providerTaskId,{headers:{Authorization:'Bearer '+credential.apiKey},signal:AbortSignal.timeout(30000)}),v=await response.json(),o=v.output??{};
 const asTime=x=>x?Date.parse(x.replace(' ','T')+'+08:00'):NaN,queued=(asTime(o.scheduled_time)-asTime(o.submit_time))/1000,generated=(asTime(o.end_time)-asTime(o.scheduled_time))/1000;
 results.push({model:r.model,providerTaskId:r.providerTaskId,status:o.task_status,submit:o.submit_time,scheduled:o.scheduled_time,end:o.end_time,queuedSeconds:Number.isFinite(queued)?queued:null,generationSeconds:Number.isFinite(generated)?generated:null,resultHost:o.video_url?new URL(o.video_url).hostname:undefined,code:o.code,usage:v.usage});
}
await writeFile(new URL('./vendor-timings.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({model,status,queuedSeconds,generationSeconds,resultHost})=>({model,status,queuedSeconds,generationSeconds,resultHost}))));
