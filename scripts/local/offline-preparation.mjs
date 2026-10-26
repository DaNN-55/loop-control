// No installer or downloader: verify operator-supplied local assets before publishing readiness.
import{readFileSync,existsSync,createReadStream}from'node:fs';
import{createHash}from'node:crypto';
import{dirname,join,isAbsolute}from'node:path';
import{assertPrivatePath}from'../isolation/environment.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const preparationFiles=d=>({manifest:join(dirname(d.deploymentFile),'offline-assets.json'),receipt:join(dirname(d.deploymentFile),'offline-preparation.json')});
export async function inspectOfflineAssets(d){
 const{manifest}=preparationFiles(d);assertPrivatePath(manifest);const bytes=readFileSync(manifest),m=JSON.parse(bytes);
 if(m.version!==1||m.model!=='jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn'||!Array.isArray(m.files)||!m.files.length||!Array.isArray(m.packages)||!m.packages.length)throw Error('Invalid offline asset manifest');
 for(const f of m.files){
  if(typeof f.path!=='string'||!isAbsolute(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0)throw Error('Invalid offline asset entry');
  assertPrivatePath(f.path);const h=createHash('sha256');let size=0;for await(const b of createReadStream(f.path)){h.update(b);size+=b.length;}
  if(size!==f.bytes||h.digest('hex')!==f.sha256)throw Error('Offline asset changed; prepare the deployment again');
 }
 return{manifest:m,identity:{deploymentSha256:sha(readFileSync(d.deploymentFile)),manifestSha256:sha(bytes),runnerSha256:sha(readFileSync(join(d.projectRoot,'scripts/whisperx-align.py'))),initializerSha256:sha(readFileSync(join(d.projectRoot,'scripts/local/initialize-whisperx.py'))),preparerSha256:sha(readFileSync(join(d.projectRoot,'scripts/local/prepare-offline.mjs'))),verifierSha256:sha(readFileSync(join(d.projectRoot,'scripts/local/offline-preparation.mjs'))),node:process.version}};
}
export async function assertOfflinePrepared(d){
 const{receipt}=preparationFiles(d);assertPrivatePath(receipt);if(!existsSync(receipt))throw Error('Offline preparation missing; run local:prepare-offline');
 const r=JSON.parse(readFileSync(receipt)),{identity}=await inspectOfflineAssets(d);
 if(r.version!==1||r.passed!==true||JSON.stringify(r.identity)!==JSON.stringify(identity)||r.modelProbeTimeoutMs!==30000)throw Error('Offline preparation missing or stale; run local:prepare-offline');
 return r;
}
