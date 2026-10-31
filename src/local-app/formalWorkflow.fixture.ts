import {parseProductionScript} from '../reviews/productionScript';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {csrfFor} from './sessions';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
export async function formalWorkflowFixture(options:{origin?:string;controlled?:boolean;scriptText?:string;blank?:boolean;freshAccount?:boolean;configurePlanning?:boolean;onBase?:(f:Awaited<ReturnType<typeof productionWorkspaceFixture>>)=>void}={}){
 const volume=await workspaceAudioVolume();const base=options.controlled?await narrationFixture(options.origin,options.onBase,true,true,{voice:workspaceTestMedia('controlled-narration-tone.mp3'),video:workspaceTestMedia('landscape-red-blue.mp4'),testRootParent:volume.mountPath,mountPath:volume.mountPath}):await productionWorkspaceFixture({origin:options.origin,testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}}});const f={...base,close:async()=>{await base.close();await volume.close();}};
 try{
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2) ON CONFLICT(singleton) DO NOTHING');
 const existing=(await f.c.query('SELECT e.account_id,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[f.episode])).rows[0],harness=randomUUID();let account=existing.account_id,assetRoot=f.assetRoot;
 if(options.freshAccount){const r=await fetch(f.origin+'/api/local/configuration',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'createAccount',idempotencyKey:randomUUID(),data:{name:'新内容账号',slug:'creative-'+randomUUID(),timezone:'Asia/Shanghai',policy:{positioning:'保留事实',tone:'克制'}}})});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));account=value.id;
  const location=await fetch(f.origin+'/api/local/account-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'readAssetDirectory',idempotencyKey:randomUUID(),data:{accountId:account}})});const directory=await location.json();assert.equal(location.status,200,JSON.stringify(directory));assetRoot=directory.assetRoot;
 }
 if(options.controlled&&existing.policy.a_roll)existing.policy.a_roll={...existing.policy.a_roll,budget_cents:90,max_attempts:1,allowed_tools:['read','write'],executor:{...existing.policy.a_roll.executor,prompt_version:'official-video-v1'}};
 await f.c.query("INSERT INTO public.prompt_versions(id,account_id,capability,version,slug,name,summary,instructions,content_hash) VALUES($1,$2,'storyboard_planning',100,'formal','Formal controlled','Controlled planning','Use original contract',$3)",[harness,account,createHash('sha256').update('Use original contract').digest('hex')]);
 await f.c.query('BEGIN');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query('SELECT public.update_current_blueprint($1,$2)',[account,{positioning:'保留事实',tone:'克制'}]);await f.c.query('SET SESSION AUTHORIZATION DEFAULT');await f.c.query('COMMIT');
 const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'create',idempotencyKey:randomUUID(),data:{accountId:account,title:'正式新单'}})});const created={status:response.status,body:await response.json()};assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.stage,'waiting_input');
 const episodeId=created.body.id;
 const send=(command:string,data:Record<string,unknown>={})=>f.request(command,{episodeId,...data});
 const chosenSend=(command:string,data:Record<string,unknown>={})=>options.controlled?(base as Awaited<ReturnType<typeof narrationFixture>>).chosenRequest(command,{episodeId,...data}):send(command,data);
 if(options.configurePlanning!==false&&options.scriptText&&!parseProductionScript(options.scriptText)){const selected=await send('saveWorkspacePlanningSelection',{expectedSelectionRevision:0,selection:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',harnessId:harness,budgetCents:0,allowedTools:['read','write']}});assert.equal(selected.status,200,JSON.stringify(selected.body));}
 if(options.blank)return{...f,assetRoot,controlled:options.controlled&&'execute'in base?base as Awaited<ReturnType<typeof narrationFixture>>:null,mountPath:volume.mountPath,send,chosenSend,newEpisode:episodeId,main:null};
 const imported=await send('importMaterial',{sourceKind:'file',sourcePath:'formal.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(options.scriptText??productionScriptTemplate).toString('base64')});assert.equal(imported.status,200,JSON.stringify(imported.body));
 return{...f,assetRoot,controlled:options.controlled&&'execute'in base?base as Awaited<ReturnType<typeof narrationFixture>>:null,mountPath:volume.mountPath,send,chosenSend,newEpisode:episodeId,main:imported.body.id};
 }catch(error){await f.close();throw error;}
}
