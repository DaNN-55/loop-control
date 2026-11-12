// One authorized external music request, imported later through the normal UI.
// API reference: https://platform.minimax.io/docs/api-reference/music-generation
// Mainland host: MiniMax-AI/skills official frontend-dev/scripts/minimax_music.py.
import{readFile,writeFile}from'node:fs/promises';
import{join}from'node:path';
import{Pool}from'pg';
import{configuredKeychainStore}from'../../../dist/local-app/local-app/keychainStore.js';
import{keychainState}from'/Users/dan/Programs/loop-control/scripts/runtime/keychain.mjs';
const root=process.cwd(),privateRoot=join(root,'.scratch/live-production');
const ledgerPath=join(root,'docs/verification/live-production-20261112/music-request.json');
try{await readFile(ledgerPath);throw Error('Music request already recorded; inspect it, do not automatically resubmit');}catch(e){if(e.code!=='ENOENT')throw e;}
const d=JSON.parse(await readFile(join(privateRoot,'deployment.json'),'utf8'));
const pool=new Pool({...d.database,user:'postgres'});
const row=(await pool.query("SELECT b.secret_ref FROM public.external_connections c JOIN local_identity.connection_bindings b ON b.version_id=c.current_version_id WHERE c.provider='minimax'")).rows[0];await pool.end();
const stored=await configuredKeychainStore(d.connections.keychain,()=>keychainState('unlock')).get(row.secret_ref);
let key=stored,region='international';try{const v=JSON.parse(stored);key=v.apiKey;region=v.region;}catch{}
const endpoint=region==='cn'?'https://api.minimaxi.com/v1/music_generation':'https://api.minimax.io/v1/music_generation';
const payload={model:'music-3.0',prompt:'Instrumental background music for a warm Chinese landscape scroll product film. Elegant guzheng and soft bamboo flute, subtle flowing water ambience, calm uplifting mood, restrained dynamics, no vocals, no spoken words, gentle beginning and a clean ending. Around 40 seconds.',is_instrumental:true,output_format:'hex',audio_setting:{sample_rate:44100,bitrate:128000,format:'mp3'}};
const ledger={provider:'minimax',endpoint,model:payload.model,status:'submission_started',startedAt:new Date().toISOString(),attempts:1,payload,actualCost:'unknown'};
const save=()=>writeFile(ledgerPath,JSON.stringify(ledger,null,2));await save();
try{
 const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(180000)});
 const v=await r.json();ledger.httpStatus=r.status;ledger.providerCode=v.base_resp?.status_code;ledger.providerMessage=String(v.base_resp?.status_msg??'').replaceAll(key,'[REDACTED]');
 if(!r.ok||v.base_resp?.status_code){ledger.status='rejected';await save();console.log(JSON.stringify(ledger));process.exitCode=1;}
 else{
  const audio=v.data?.audio;
  if(typeof audio!=='string'||!/^[a-f\d]+$/i.test(audio)||audio.length%2)throw Error('No valid hex audio returned; retain unknown outcome');
  const file=join(privateRoot,'日照金山-API配乐.mp3');await writeFile(file,Buffer.from(audio,'hex'));
  ledger.status='received';ledger.artifact=file;ledger.bytes=audio.length/2;ledger.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:ledger.status,bytes:ledger.bytes,artifact:file}));
 }
}catch(e){ledger.status='unknown';ledger.error=String(e.message).replaceAll(key,'[REDACTED]');await save();throw Error('Music outcome unknown; inspect the ledger, no automatic retry');}
