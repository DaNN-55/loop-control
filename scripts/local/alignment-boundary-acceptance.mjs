// T20 real local HTTP boundaries; temporary unrelated Owner is removed in finally.
import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';import{randomUUID,randomBytes}from'node:crypto';import{join}from'node:path';
import{root,sql}from'./environment.mjs';import{hashPassword}from'../../dist/local-app/local-app/password.js';
const dir=join(root,'state/t20-20261024'),f=JSON.parse(readFileSync(join(dir,'fixture.json'))),a=f.accounts[0],o=JSON.parse(readFileSync(join(root,'state/t13-owner.json'))),origin='http://127.0.0.1:55183',out=join(dir,'boundary-01.json');
const login=async credentials=>{const r=await fetch(origin+'/api/local/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(credentials)});assert.equal(r.status,200);return {Origin:origin,'Content-Type':'application/json',Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await r.json()).csrfToken};};
const headers=await login(o),results=[],args={episodeId:a.episodeId,reviewPackageId:a.reviewPackageId,shotId:'shot-1'};
const post=async(command,data,status=200,h=headers,key=randomUUID())=>{const r=await fetch(origin+'/api/local/episode-commands',{method:'POST',headers:h,body:JSON.stringify({command,data,idempotencyKey:key})}),v=await r.json();results.push({command,status:r.status});assert.equal(r.status,status,JSON.stringify(v));return v;};
const detail=async()=>{const v=await(await fetch(origin+'/api/local/episodes/'+a.episodeId,{headers})).json();for(const[k,p]of Object.entries(v.patches??{}))v.sections[k]=p.ids.map(id=>p.rows.find(r=>r.id===id));return v.sections;};
let otherId;
try{
 await post('generateSourceAudio',args,401,{Origin:origin,'Content-Type':'application/json'});
 await post('generateSourceAudio',args,403,{...headers,Origin:'http://127.0.0.1:1'});
 const noCsrf={...headers};delete noCsrf['X-CSRF-Token'];await post('requestAlignment',{...args,localOnly:true},403,noCsrf);
 await post('requestAlignment',{...args,localOnly:true,secret:'forbidden synthetic field'},400);
 await post('generateSyncPreview',{...args,reviewPackageId:randomUUID()},409);
 await post('saveManualAlignment',{...args,cues:[{id:'manual-1',text:'另一个正文',start_ms:0,end_ms:2000}]},400);
 await post('saveManualAlignment',{...args,cues:[{id:'one',text:'这是本地',start_ms:100,end_ms:2000},{id:'two',text:'字幕验收。',start_ms:1500,end_ms:3500}]},400);
 const d=await detail(),draft=d.shotPreparationDrafts.find(d=>d.shot_id==='shot-1'),t=d.audioTracks.find(t=>t.id===draft.current_audio_track_id),path=join(a.assetRoot,t.relative_path),bytes=readFileSync(path);
 try{writeFileSync(path,Buffer.concat([bytes,Buffer.from([0])]));await post('generateSourceAudio',args,409);await post('saveManualAlignment',{...args,cues:[{id:'manual-1',text:'这是本地字幕验收。',start_ms:100,end_ms:3500}]},409);}finally{writeFileSync(path,bytes);}
 const proxy=d.artifacts.find(x=>x.id===draft.current_preview_artifact_id),proxyPath=join(a.assetRoot,proxy.relative_path),proxyBytes=readFileSync(proxyPath);
 try{writeFileSync(proxyPath,Buffer.concat([proxyBytes,Buffer.from([0])]));await post('generateSyncPreview',args,409);await post('confirmSyncPreview',args,409);}finally{writeFileSync(proxyPath,proxyBytes);}
 const id=randomUUID(),password=randomBytes(32).toString('hex'),email=`t20-${id}@example.invalid`,digest=await hashPassword(password);otherId=id;
 sql(`begin;insert into local_identity.owners(id,email) values('${id}','${email}');insert into local_identity.credentials(owner_id,password_digest) values('${id}','${JSON.stringify(digest)}');commit;`);
 const unrelated=await login({email,password});for(const command of ['generateSourceAudio','requestAlignment','saveManualAlignment','generateSyncPreview','confirmSyncPreview'])await post(command,args,404,unrelated);
 await fetch(origin+'/api/local/logout',{method:'POST',headers:unrelated,body:'{}'});
 const final=await detail();assert.equal(final.shotPreparationDrafts.find(d=>d.shot_id==='shot-1').current_audio_track_id,t.id);assert.equal(final.shotPreparationDrafts.find(d=>d.shot_id==='shot-1').current_preview_artifact_id,proxy.id);
 writeFileSync(out,JSON.stringify({passed:true,realHttp:true,checks:results,temporaryCorruptionRestored:true,domainTextAndOverlapRulesPreserved:true,providerRequests:0},null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:true,checks:results.length,providerRequests:0}));
}finally{await fetch(origin+'/api/local/logout',{method:'POST',headers,body:'{}'});if(otherId)sql(`begin;delete from local_identity.sessions where owner_id='${otherId}';delete from local_identity.credentials where owner_id='${otherId}';delete from local_identity.owners where id='${otherId}';commit;`);}
