import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {csrfFor} from './sessions';
import {workspaceAudioVolume} from './workspaceAudioVolume.fixture';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {narrationFixture} from './workspaceNarration.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
export async function formalWorkflowFixture(options:{origin?:string;controlled?:boolean;scriptText?:string;blank?:boolean;onBase?:(f:Awaited<ReturnType<typeof productionWorkspaceFixture>>)=>void}={}){
 const volume=await workspaceAudioVolume();const base=options.controlled?await narrationFixture(options.origin,options.onBase,true,true,{voice:workspaceTestMedia('controlled-narration-tone.mp3'),video:workspaceTestMedia('landscape-red-blue.mp4'),testRootParent:volume.mountPath,mountPath:volume.mountPath}):await productionWorkspaceFixture({origin:options.origin,testRootParent:volume.mountPath,runtime:{mountPath:volume.mountPath,wake(){}}});const f={...base,close:async()=>{await base.close();await volume.close();}};
 try{
 await f.c.query('INSERT INTO public.worker_scheduler_settings(singleton,capacity) VALUES(true,2) ON CONFLICT(singleton) DO NOTHING');
 const existing=(await f.c.query('SELECT e.account_id,b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[f.episode])).rows[0],account=existing.account_id,harness=randomUUID();
 if(options.controlled&&existing.policy.a_roll)existing.policy.a_roll={...existing.policy.a_roll,budget_cents:90,max_attempts:1,allowed_tools:['read','write'],executor:{...existing.policy.a_roll.executor,prompt_version:'official-video-v1'}};
 await f.c.query("INSERT INTO public.prompt_versions(id,account_id,capability,version,slug,name,summary,instructions,content_hash) VALUES($1,$2,'storyboard_planning',100,'formal','Formal controlled','Controlled planning','Use original contract',$3)",[harness,account,'a'.repeat(64)]);
 await f.c.query('BEGIN');await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);await f.c.query('SET SESSION AUTHORIZATION loop_app');await f.c.query('SELECT public.update_current_blueprint($1,$2)',[account,{...existing.policy,asset_root:f.assetRoot,allowed_tools:['read','write'],budgets:{storyboard_planning_cents:0},executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'gpt-5.6-luna',prompt_version:'storyboard-planning-v2',harness_id:harness}}}]);await f.c.query('SET SESSION AUTHORIZATION DEFAULT');await f.c.query('COMMIT');
 const response=await fetch(f.origin+'/api/local/episode-commands',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',Cookie:'loop_owner_session='+f.token,'X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command:'create',idempotencyKey:randomUUID(),data:{accountId:account,title:'正式新单'}})});const created={status:response.status,body:await response.json()};assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(created.body.stage,'waiting_input');
 const episodeId=created.body.id;
 const send=(command:string,data:Record<string,unknown>={})=>f.request(command,{episodeId,...data});
 if(options.blank)return{...f,controlled:options.controlled&&'execute'in base?base as Awaited<ReturnType<typeof narrationFixture>>:null,mountPath:volume.mountPath,send,newEpisode:episodeId,main:null};
 const imported=await send('importMaterial',{sourceKind:'file',sourcePath:'formal.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(options.scriptText??productionScriptTemplate).toString('base64')});assert.equal(imported.status,200,JSON.stringify(imported.body));
 return{...f,controlled:options.controlled&&'execute'in base?base as Awaited<ReturnType<typeof narrationFixture>>:null,mountPath:volume.mountPath,send,newEpisode:episodeId,main:imported.body.id};
 }catch(error){await f.close();throw error;}
}
