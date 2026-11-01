import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {narrationFixture} from './workspaceNarration.fixture';
import {productionHash} from './scriptProductionStore';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
export async function workspaceImageGenerationFixture(migrations:string[]=[],episodeRelativePath?:(episodeId:string)=>string){
 const f=await narrationFixture(undefined,undefined,true,false,{migrations:['db/local/127-connection-model-settings.sql','db/local/128-connection-model-discovery.sql','db/local/129-bailian-video-models.sql',...migrations],episodeRelativePath});try{
 const version=randomUUID(),connection=randomUUID(),secret=randomUUID();
 await f.c.query('BEGIN');
 await f.c.query("SELECT set_config('loop.owner_id',$1,true)",[f.owner]);
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'openai','openai_images','Controlled image batch',$2,$3,'https://api.openai.com/v1')",[connection,f.owner,version]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id) VALUES($1,$2,1,'openai','openai_images','https://api.openai.com/v1',$3)",[version,connection,secret]);
 await f.c.query("INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES($1,$2,$3,'keychain')",[version,f.owner,secret]);
 await f.c.query('INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES($1,$2,true)',[version,f.owner]);
 await f.c.query("INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES($1,$2,'live','verified')",[version,f.owner]);
 const policy=(await f.c.query('SELECT b.policy FROM public.episodes e JOIN public.account_blueprint_versions b ON b.id=e.blueprint_version_id WHERE e.id=$1',[f.episode])).rows[0].policy;
 policy.static_visual={execution_path:'external',credential_ref:version,executor:{provider:'openai',adapter:'openai_images',model:'gpt-image-2',prompt_version:'static-visual-v1'},budget_cents:100,max_attempts:1};
 const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 await f.c.query('SET SESSION AUTHORIZATION loop_app');
 await f.c.query('SELECT public.update_current_blueprint($1,$2)',[account,policy]);
 await f.c.query('SET SESSION AUTHORIZATION DEFAULT');
 await f.c.query('UPDATE public.episodes SET blueprint_version_id=(SELECT current_blueprint_version_id FROM public.accounts WHERE id=$2) WHERE id=$1',[f.episode,account]);
 await f.c.query('COMMIT');
 await f.authorize();await f.c.query('UPDATE local_identity.script_productions SET plan=$2 WHERE episode_id=$1',[f.episode,{executionFingerprint:productionHash(policy)}]);

 const ref=await f.request('importMaterial',{materialType:'image',sourceKind:'file',sourcePath:'reference.png',mimeType:'image/png',contentBase64:(await readFile(workspaceTestMedia('still-striped.png'))).toString('base64'),isMainScript:false,materialPurpose:'visual_reference'});if(ref.status!==200)throw Error(JSON.stringify(ref.body));
 const submissions=join(f.root,'image-submissions.jsonl');await writeFile(join(f.root,'controlled-video.mjs'),`import{readFileSync,appendFileSync}from'node:fs';export async function createNarrationPorts(){return{mode:'controlled',store:{mode:'keychain',get:async ref=> 'synthetic-image-'+ref},fetcher:async(url,init)=>{const body=JSON.parse(init.body);appendFileSync(${JSON.stringify(submissions)},JSON.stringify({url:String(url),body,credentialRef:new Headers(init.headers).get('Authorization')?.replace('Bearer synthetic-image-','')})+'\\n');if(readFileSync(${JSON.stringify(f.responseMode)},'utf8')==='unknown')throw Error('Controlled image transport break');return Response.json({data:Array.from({length:body.n},()=>({b64_json:readFileSync(${JSON.stringify(workspaceTestMedia('still-striped.png'))}).toString('base64')}))});}};}`);
 return {f,ref,submissions};
 }catch(error){await f.close();throw error;}
}
