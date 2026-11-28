import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {resolveEpisodeAssetRoot} from './accountAssetRoots.js';
import {canonicalFingerprint,ConfigurationError} from './configurationCommands.js';
import type {LocalEpisodeCommands} from './episodeCommands.js';
import {episodeFileIO} from './episodeFiles.js';
import {harnessHandoffVersion,HarnessHandoffPackageError,readHarnessHandoffPackage} from './harnessHandoffPackage.js';
import {createHarnessHandoffResults,type HarnessHandoffResultInput} from './harnessHandoffResult.js';
import {snapshotInput,verifyNativeFileIdentity} from './localFiles.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import {ScriptProductionStore} from './scriptProductionStore.js';
import type {OwnerSession} from './sessions.js';
import {readWorkspaceDeliveries} from './workspaceDeliveryCommands.js';

type Pack=Awaited<ReturnType<typeof readHarnessHandoffPackage>>;
type Candidate={pack?:Pick<Pack,'manifest'|'parsed'|'digest'>;error?:HarnessHandoffPackageError;fingerprint?:string};
const fileStamp=async(path:string)=>{const s=await lstat(path,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');};
type Row={handoff_id:string;revision:number;digest:string;title:string;product_id:string;aspect_ratio:string|null;duration_seconds:string|null;episode_id:string|null;account_id:string|null;series_version_id:string|null};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const absent=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
const store=new ScriptProductionStore();

async function privateDirectory(path:string){
 const stat=await lstat(path);
 if(!stat.isDirectory()||stat.uid!==process.getuid?.()||(stat.mode&0o022)!==0||await realpath(path)!==path)throw Error('交接目录不是当前用户拥有的安全目录。');
 return path;
}

export class LocalHarnessHandoff {
 private running?:Promise<void>;
 private timer?:ReturnType<typeof setInterval>;
 private packages=new Map<string,Candidate>();
 private verifiedVideos=new Map<string,string>();
 private report:(error:unknown)=>void=()=>{};
 private results:ReturnType<typeof createHarnessHandoffResults>;
 constructor(private options:{root:string;origin:string;ownerId:string;pool:Pool;mediaRoot:string;episodes:LocalEpisodeCommands}){
  if(!uuid.test(options.ownerId))throw Error('Harness 交接需要指定已有 Owner UUID。');
  const url=new URL(options.origin);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.origin!==options.origin)throw Error('Harness 交接只支持本机 Loop Control。');
  this.results=createHarnessHandoffResults(options.root);
 }
 allows(ownerId:string){return ownerId===this.options.ownerId;}
 start(report:(error:unknown)=>void){
  this.report=report;
  if(!this.timer){const tick=()=>void this.refresh().catch(report);this.timer=setInterval(tick,2500);this.timer.unref();tick();}
  return this;
 }
 async close(){clearInterval(this.timer);this.timer=undefined;await this.running?.catch(()=>{});}
 refresh(){
  return this.running??=this.scan().finally(()=>{this.running=undefined;});
 }
 private async directories(){
  const root=await privateDirectory(resolve(this.options.root));
  const inbox=join(root,'in');
  try{await privateDirectory(inbox);}catch(error){if(absent(error))return[];throw error;}
  const keys:{id:string;revision:number}[]=[];
  for(const d of (await readdir(inbox,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   if(!d.isDirectory())continue;
   try{harnessHandoffVersion(d.name,1);}catch{continue;}
   const folder=join(inbox,d.name);await privateDirectory(folder);
   for(const v of await readdir(folder,{withFileTypes:true})){const revision=Number(v.name.slice(1));if(v.isDirectory()&&/^v\d{4}$/.test(v.name)&&revision>0)keys.push({id:d.name,revision});}
  }
  return keys;
 }
 private rows(){const {pool,ownerId}=this.options;return ownerTransaction(pool,ownerId,true,async c=>(await c.query<Row>('SELECT * FROM local_identity.harness_handoffs WHERE owner_id=$1 ORDER BY received_at DESC,handoff_id,revision DESC',[ownerId])).rows);}
 private async scan(){
  const {root,pool,ownerId}=this.options;
  const keys=await this.directories(),next=new Map<string,Candidate>();
  for(const {id,revision} of keys){
   const key=`${id}/${revision}`,old=this.packages.get(key),dir=join(root,'in',id,harnessHandoffVersion(id,revision));
   const stamp=(paths:readonly string[])=>Promise.all(['','manifest.json','script.md','images',...paths].map(p=>fileStamp(join(dir,p)))).then(v=>v.join('|')).catch(()=>undefined);
   const before=old?.pack&&await stamp(old.pack.manifest.product_images);
   if(before&&before===old?.fingerprint){next.set(key,old);continue;}
   try{
    const {manifest,parsed,digest}=await readHarnessHandoffPackage(root,id,revision);
    const fingerprint=before&&await stamp(manifest.product_images)===before?before:undefined;
    const times=parsed.segments.map(s=>s.settings.duration),seconds=parsed.settings.duration??(times.every(v=>v!==undefined)?times.reduce<number>((n,v)=>n+(v??0),0):null);
    await ownerTransaction(pool,ownerId,false,c=>c.query(`INSERT INTO local_identity.harness_handoffs(owner_id,handoff_id,revision,digest,title,product_id,aspect_ratio,duration_seconds)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_id,handoff_id,revision) DO NOTHING`,[ownerId,id,revision,digest,manifest.title,manifest.product_id,parsed.settings.aspectRatio??null,seconds]));
    next.set(key,{pack:{manifest,parsed,digest},fingerprint});
   }catch(error){if(!(error instanceof HarnessHandoffPackageError))throw error;next.set(`${id}/${revision}`,{error});}
  }
  this.packages=next;
  const rows=await this.rows(),byKey=new Map(rows.map(row=>[`${row.handoff_id}/${row.revision}`,row]));
  for(const {id,revision} of keys){
   const key=`${id}/${revision}`,candidate=next.get(key)!,row=byKey.get(key);
   if(row?.episode_id)continue;
   if(candidate.error||!row||row.digest!==candidate.pack?.digest){
    await this.writeStatus({handoffId:id,revision,status:'needs_attention',reasonCode:candidate.error?.code??'revision_conflict',message:candidate.error?.message??'此修订的内容已变化，请使用新修订。'}).catch(this.report);
   }else{
    const newer=rows.some(r=>r.handoff_id===id&&r.episode_id!==null);
    await this.writeStatus({handoffId:id,revision,status:newer?'needs_attention':'received',reasonCode:newer?'confirm_revision':undefined,message:newer?'该选题已有生产单，请确认新修订后单独建单。':'已接收制作包，等待 Owner 确认生产设置。'}).catch(this.report);
   }
  }
  for(const row of rows.filter(r=>r.episode_id)){
   const candidate=next.get(`${row.handoff_id}/${row.revision}`);
   await this.reconcile(row,Boolean(candidate&&candidate.pack?.digest!==row.digest)).catch(this.report);
  }
 }
 async list(session:OwnerSession){
  if(!this.allows(session.id))return {enabled:false,items:[]};
  if(!this.timer)await this.refresh();
  const rows=await this.rows(),known=new Set<string>();
  const items=await Promise.all(rows.map(async row=>{
   const id=row.handoff_id,revision=row.revision,key=`${id}/${revision}`,candidate=this.packages.get(key);known.add(key);
   const conflict=candidate?.pack?.digest!==row.digest;
   const status=await this.results.read(id,revision);
   return {handoffId:id,revision,title:row.title,productId:row.product_id,status:row.episode_id&&conflict&&candidate?'needs_attention':status?.status??'received',message:row.episode_id&&conflict&&candidate?'原单已保留；如需变更请发布新修订。':status?.message??'等待状态回写。',aspectRatio:row.aspect_ratio,durationSeconds:row.duration_seconds===null?null:Number(row.duration_seconds),episodeId:status?.production_order?.id??null,digest:row.digest,canAccept:!row.episode_id&&!conflict,accountId:row.account_id,seriesVersionId:row.series_version_id};
  }));
  for(const [key,candidate] of this.packages)if(!known.has(key)&&candidate.error){const [id,rev]=key.split('/');items.push({handoffId:id,revision:Number(rev),title:id,productId:'',status:'needs_attention',message:candidate.error.message,aspectRatio:null,durationSeconds:null,episodeId:null,digest:'',canAccept:false,accountId:null,seriesVersionId:null});}
  return {enabled:true,items};
 }
 async accept(session:OwnerSession,body:Record<string,unknown>){
  const {pool,root,episodes}=this.options;
  if(!this.allows(session.id))throw new ConfigurationError(404,'此 Owner 未启用制作包接单。');
  const {handoffId,revision,accountId,expectedDigest}=body,seriesVersionId=body.seriesVersionId??null;
  if(Object.keys(body).some(key=>!['handoffId','revision','accountId','seriesVersionId','expectedDigest'].includes(key))||typeof handoffId!=='string'||typeof revision!=='number'||typeof accountId!=='string'||!uuid.test(accountId)||seriesVersionId!==null&&(typeof seriesVersionId!=='string'||!uuid.test(seriesVersionId))||typeof expectedDigest!=='string'||!/^[0-9a-f]{64}$/.test(expectedDigest))throw new ConfigurationError(400,'接单请求无效。');
  let pack:Pack;
  try{pack=await readHarnessHandoffPackage(root,handoffId,revision);}catch(error){if(error instanceof HarnessHandoffPackageError)throw new ConfigurationError(409,error.message);throw error;}
  if(pack.digest!==expectedDigest)throw new ConfigurationError(409,'制作包已变化，请重新核对。');
  const ids=[session.id,handoffId,revision];
  const row=await sessionTransaction(pool,session,async c=>{
   const r=(await c.query<Row>('SELECT * FROM local_identity.harness_handoffs WHERE owner_id=$1 AND handoff_id=$2 AND revision=$3 FOR UPDATE',ids)).rows[0];
   if(!r||r.digest!==expectedDigest)throw new ConfigurationError(409,'制作包未接收或与原修订不同。');
   if(r.account_id&&(r.account_id!==accountId||r.series_version_id!==seriesVersionId))throw new ConfigurationError(409,'该修订已固定接单账号和系列，请按原设置恢复。');
   if(!r.account_id){
    if(!(await c.query("SELECT 1 FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id WHERE a.id=$1 AND a.archived_at IS NULL AND m.user_id=$2 AND m.role='owner'",[accountId,session.id])).rowCount)throw new ConfigurationError(404,'生产账号不可见。');
    if(seriesVersionId&&!(await c.query('SELECT 1 FROM public.series_versions WHERE id=$1 AND account_id=$2',[seriesVersionId,accountId])).rowCount)throw new ConfigurationError(400,'所选系列不属于该账号。');
    await c.query('UPDATE local_identity.harness_handoffs SET account_id=$4,series_version_id=$5 WHERE owner_id=$1 AND handoff_id=$2 AND revision=$3',[...ids,accountId,seriesVersionId]);
   }
   return r;
  });
  if(row.episode_id)return {episodeId:row.episode_id};
  const key=createHash('sha256').update(JSON.stringify(['harness-handoff',...ids])).digest('hex').slice(0,32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
  const data={accountId,seriesVersionId,title:pack.manifest.title};
  const created=await episodes.createFromHandoff(session,key,canonicalFingerprint({key,data,expectedDigest}),data,async(c,episode)=>{
   const episodeId=String(episode.id),media=await resolveEpisodeAssetRoot(c,this.options.mediaRoot,episodeId);
   await this.importInputs(c,session.id,media,episodeId,pack);
   await c.query('UPDATE local_identity.harness_handoffs SET episode_id=$4 WHERE owner_id=$1 AND handoff_id=$2 AND revision=$3',[...ids,episodeId]);
  });
  await this.refresh().catch(()=>{});
  return {episodeId:String(created.id)};
 }
 private async importInputs(c:PoolClient,ownerId:string,root:string,episodeId:string,pack:Pack){
  const storage=await episodeFileIO(c,root,episodeId);
  const inputs=[{name:'script.md',mimeType:'text/markdown',bytes:Buffer.from(pack.script),main:true},...pack.images.map(image=>({...image,main:false}))];
  for(const input of inputs){
   const materialType=input.main?'script':'image',purpose=input.main?'main_script':'visual_reference';
   const snapshot=await snapshotInput(root,episodeId,{sourceKind:'file',sourcePath:input.name,isMainScript:input.main,contentBase64:input.bytes.toString('base64')},storage.relativePath);
   const {result}=(await c.query('SELECT to_jsonb(public.import_production_material($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)) result',[episodeId,materialType,'file',snapshot.sourcePath,snapshot.storagePath,input.mimeType,snapshot.sha256,snapshot.fileSize,input.main,purpose])).rows[0];
   if(!input.main)await store.alias(c,ownerId,result.id,input.name);
  }
  await c.query('UPDATE local_identity.input_episodes SET script_template_version=3 WHERE episode_id=$1',[episodeId]);
  await storage.assertValid();
 }
 private async reconcile(row:Row,revisionConflict:boolean){
  const {pool,ownerId,mediaRoot,origin}=this.options,episodeId=row.episode_id!;
  const result=await ownerTransaction(pool,ownerId,true,async c=>{
   const e=(await c.query("SELECT e.stage,e.archived_at,EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin b WHERE b.episode_id=e.id) recycled FROM public.episodes e JOIN public.account_memberships m ON m.account_id=e.account_id WHERE e.id=$1 AND m.user_id=$2 AND m.role='owner'",[episodeId,ownerId])).rows[0];
   const link=(step?:string)=>({id:episodeId,url:`${origin}/?${new URLSearchParams({view:'episodes',episode:episodeId,...(step?{step}:{})})}`});
   if(!e||e.recycled||e.archived_at)return {status:'needs_attention' as const,reasonCode:'order_unavailable',message:'原生产单已归档、删除或不可见。'};
   if(revisionConflict&&e.stage!=='production_completed')return {status:'needs_attention' as const,reasonCode:'revision_conflict',productionOrder:link(),message:'此修订的内容已变化，原单保留；如需变更请发布新修订。'};
   if(e.stage==='waiting_input')return {status:'received' as const,productionOrder:link(),message:'已接单，等待在 Loop Control 确认脚本并开始制作。'};
   const workspace=(await c.query('SELECT id,episode_id FROM local_identity.production_workspaces WHERE episode_id=$1',[episodeId])).rows[0];
   const latest=workspace&&(await c.query('SELECT d.id,t.status FROM local_identity.workspace_deliveries d JOIN public.tasks t ON t.id=d.task_id WHERE d.workspace_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT 1',[workspace.id])).rows[0];
   if(latest&&['failed','blocked'].includes(latest.status))return {status:'failed' as const,reasonCode:'delivery_failed',productionOrder:link('delivery'),message:'正式交付未完成，请在 Loop Control 检查。'};
   if(e.stage!=='production_completed'||!workspace||latest?.status!=='completed')return {status:'producing' as const,productionOrder:link(),message:'制作中，尚未正式交付。'};
   const key=`${row.handoff_id}/${row.revision}`,out=join(this.options.root,'out',row.handoff_id,harnessHandoffVersion(row.handoff_id,row.revision));
   const stamp=()=>Promise.all([fileStamp(join(out,'result.json')),fileStamp(join(out,'exports','final.mp4'))]).then(v=>v.join('|')).catch(()=>undefined);
   const before=await stamp();
   if(before&&this.verifiedVideos.get(key)===before)return null;
   this.verifiedVideos.delete(key);
   const previous=await this.results.read(row.handoff_id,row.revision);
   if(previous?.status==='delivered'&&await this.results.readPlayable(row.handoff_id,row.revision)){
    if(before&&await stamp()===before)this.verifiedVideos.set(key,before);
    return null;
   }
   const root=await resolveEpisodeAssetRoot(c,mediaRoot,episodeId),storage=await episodeFileIO(c,root,episodeId);
   const [delivery]=await readWorkspaceDeliveries(c,root,workspace,latest.id),video=delivery?.artifacts.find(a=>a.artifactType==='final_render');
   if(!delivery?.verified||!video)return {status:'needs_attention' as const,reasonCode:'delivery_unverified',productionOrder:link('delivery'),message:'正式交付文件无法验证，请在 Loop Control 检查。'};
   const path=await storage.resolveReference(video.relativePath);
   await verifyNativeFileIdentity(root,relative(root,path),video.sha256,video.fileSize);
   return {status:'delivered' as const,productionOrder:link('delivery'),message:'已交付成片（未发布）。',delivery:{sha256:video.sha256,fileSize:video.fileSize,open:()=>open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK).then(handle=>handle.createReadStream())}};
  });
  if(result)await this.writeStatus({handoffId:row.handoff_id,revision:row.revision,...result});
 }
 private async writeStatus(input:HarnessHandoffResultInput){
  if(!input.delivery){
   const previous=await this.results.read(input.handoffId,input.revision);
   if(previous?.status==='delivered'||previous?.status===input.status&&previous.message===input.message&&previous.reason_code===input.reasonCode&&(!input.productionOrder||previous.production_order?.url===input.productionOrder.url))return;
  }
  await this.results.write(input);
 }
}
