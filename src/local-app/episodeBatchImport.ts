import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {ConfigurationError,canonicalFingerprint} from './configurationCommands.js';
import {createEpisodeDirectory,EpisodeCreationSkipped} from './episodeCreation.js';
import {ownerTransaction,sessionTransaction} from './ownerTransaction.js';
import type {OwnerSession} from './sessions.js';
import {episodeImportLimits,type EpisodeImportItem,type EpisodeImportReceipt,type ImportedScript} from './episodeBatchImportTypes.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fingerprint=(text:string)=>createHash('sha256').update(text).digest('hex');
const contains=(value:object,keys:string[])=>Object.keys(value).some(key=>!keys.includes(key));
const textField=(value:unknown,maximum:number):value is string=>typeof value==='string'&&value.length<=maximum&&!value.includes('\0');
const duration=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0.1&&value<=3600;

type ImportInput={accountId:string;seriesVersionId:string|null;items:EpisodeImportItem[]};
type ImportItemPayload=Required<EpisodeImportItem>&{sourceSha256:string};
type PendingImport={payload:ImportItemPayload&{seriesVersionId:string|null}};

function importInput(body:Record<string,unknown>):ImportInput{
 if(contains(body,['action','batchId','accountId','seriesVersionId','items'])||
    typeof body.accountId!=='string'||!uuid.test(body.accountId)||
    body.seriesVersionId!==null&&(typeof body.seriesVersionId!=='string'||!uuid.test(body.seriesVersionId))||
    !Array.isArray(body.items)||!body.items.length||body.items.length>episodeImportLimits.items)throw new ConfigurationError(400,'请选择账号、系列和要导入的脚本。');
 const ids=new Set<string>();
 for(const item of body.items){
  if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.itemId!=='string'||!uuid.test(item.itemId)||ids.has(item.itemId))throw new ConfigurationError(400,'导入项标识无效或重复。');
  const label=textField(item.sourceName,episodeImportLimits.sourceNameLength)&&item.sourceName.trim()?item.sourceName:'未知来源';
  if(contains(item,['itemId','sourceName','title','sourceText','targetDuration','shots','duplicate'])||
     !textField(item.sourceName,episodeImportLimits.sourceNameLength)||!item.sourceName.trim()||
     !textField(item.title,200)||!item.title.trim()||
     !textField(item.sourceText,episodeImportLimits.sourceLength)||
     item.targetDuration!=null&&!duration(item.targetDuration)||
     item.duplicate!==undefined&&!['skip','create'].includes(item.duplicate))throw new ConfigurationError(400,label+'：请检查标题、正文和时长。');
  const shots=item.shots??[];
  if(!Array.isArray(shots)||shots.length>100||shots.some((shot,index)=>!shot||typeof shot!=='object'||Array.isArray(shot)||
     contains(shot,['sequence','visual','videoPrompt','narration','caption','durationSeconds'])||
     !Number.isSafeInteger(shot.sequence)||shot.sequence<1||index>0&&shot.sequence<=shots[index-1].sequence||
     !textField(shot.visual,4000)||!textField(shot.videoPrompt,4000)||!textField(shot.narration,4000)||!textField(shot.caption,4000)||
     ![shot.visual,shot.videoPrompt,shot.narration,shot.caption].some(field=>field.trim())||!duration(shot.durationSeconds)))throw new ConfigurationError(400,label+'：请检查镜头顺序、文字和时长。');
  if(!item.sourceText.trim()&&!shots.length)throw new ConfigurationError(400,label+'：请填写脚本正文或分镜。');
  ids.add(item.itemId);
 }
 return {accountId:body.accountId,seriesVersionId:body.seriesVersionId,items:body.items};
}

function itemPayload(item:EpisodeImportItem):ImportItemPayload{
 return {...item,title:item.title.trim(),duplicate:item.duplicate??'skip',targetDuration:item.targetDuration??null,shots:item.shots??[],
  sourceSha256:item.sourceText.trim()?fingerprint(item.sourceText):canonicalFingerprint(item.shots)};
}

async function ownedSeries(c:PoolClient,ownerId:string,input:ImportInput):Promise<string|null>{
 const account=await c.query(`SELECT 1 FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id
  WHERE a.id=$1 AND m.user_id=$2 AND m.role='owner' AND a.archived_at IS NULL`,[input.accountId,ownerId]);
 if(!account.rowCount)throw new ConfigurationError(404,'账号不可见。');
 if(input.seriesVersionId===null)return null;
 const version=(await c.query('SELECT series_id FROM public.series_versions WHERE id=$1 AND account_id=$2',[input.seriesVersionId,input.accountId])).rows[0];
 if(!version)throw new ConfigurationError(400,'系列版本不属于此账号。');
 return version.series_id;
}

async function duplicateEpisode(c:PoolClient,accountId:string,seriesId:string|null,title:string,sha256:string):Promise<string|null>{
 const result=await c.query(`SELECT e.id FROM public.episodes e
  LEFT JOIN local_identity.episode_asset_locations l ON l.episode_id=e.id
  LEFT JOIN public.series_versions v ON v.id=e.series_version_id
  LEFT JOIN local_identity.episode_import_drafts d ON d.episode_id=e.id
  LEFT JOIN public.production_material_revisions r ON r.id=e.main_script_revision_id
  WHERE e.account_id=$1 AND e.title=$3
    AND (CASE WHEN l.layout_version=2 THEN l.storage_series_id ELSE v.series_id END) IS NOT DISTINCT FROM $2::uuid
    AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin b WHERE b.episode_id=e.id)
    AND (d.source_sha256=$4 OR r.sha256=$4 OR EXISTS(
     SELECT 1 FROM local_identity.script_studio_confirmations s
     WHERE s.episode_id=e.id AND s.script_revision_id=e.main_script_revision_id AND s.source_sha256=$4))
  ORDER BY e.created_at,e.id LIMIT 1`,[accountId,seriesId,title,sha256]);
 return result.rows[0]?.id??null;
}

export async function readImportedScript(c:PoolClient,ownerId:string,episodeId:string):Promise<ImportedScript|null>{
 const result=await c.query(`SELECT d.source_name AS "sourceName", d.source_text AS "sourceText", d.target_duration::float8 AS "targetDuration",d.shots,d.version
  FROM local_identity.episode_import_drafts d JOIN public.episodes e ON e.id=d.episode_id
  JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=d.owner_id AND m.role='owner'
  WHERE d.episode_id=$1 AND d.owner_id=$2 AND e.stage='waiting_input' AND e.main_script_revision_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM local_identity.episode_recycle_bin b WHERE b.episode_id=e.id)`,[episodeId,ownerId]);
 return result.rows[0]??null;
}

export class LocalEpisodeBatchImport {
 constructor(private pool:Pool,private mediaRoot:string,private preflight:Parameters<typeof createEpisodeDirectory>[6]){}

 async preview(session:OwnerSession,body:Record<string,unknown>){
  const input=importInput(body);
  return sessionTransaction(this.pool,session,async c=>{
   const seriesId=await ownedSeries(c,session.id,input),seen=new Set<string>();
   const items=[];
   for(const item of input.items.map(itemPayload)){
    const identity=JSON.stringify([item.title,item.sourceSha256]);
    const episodeId=await duplicateEpisode(c,input.accountId,seriesId,item.title,item.sourceSha256);
    items.push({itemId:item.itemId,duplicateEpisodeId:episodeId,duplicateInBatch:seen.has(identity)});
    seen.add(identity);
   }
   return {items};
  });
 }

 async read(session:OwnerSession,batchId:string):Promise<EpisodeImportReceipt>{
  if(!uuid.test(batchId))throw new ConfigurationError(404,'导入批次不可见。');
  return ownerTransaction(this.pool,session.id,true,async c=>{
   await this.ownedBatch(c,session.id,batchId);
   const {rows}=await c.query(`SELECT item_id AS "itemId",title,source_name AS "sourceName",status,reason,episode_id AS "episodeId"
    FROM local_identity.episode_import_items WHERE owner_id=$1 AND batch_id=$2 ORDER BY position`,[session.id,batchId]);
   return {batchId,items:rows};
  });
 }

 async run(session:OwnerSession,body:Record<string,unknown>){
  if(typeof body.batchId!=='string'||!uuid.test(body.batchId)||!['submit','retry'].includes(String(body.action)))throw new ConfigurationError(400,'导入批次请求无效。');
  const batchId=body.batchId;
  if(body.action==='submit')await this.reserve(session,batchId,importInput(body));
  else if(contains(body,['action','batchId']))throw new ConfigurationError(400,'重试请求无效。');
  const {accountId,rows}=await sessionTransaction(this.pool,session,async c=>{
   const batch=await this.ownedBatch(c,session.id,batchId);
   const pending=await c.query<PendingImport>(`SELECT payload FROM local_identity.episode_import_items
    WHERE owner_id=$1 AND batch_id=$2 AND status IN ('pending','failed') ORDER BY position`,[session.id,batchId]);
   return {accountId:batch.account_id,rows:pending.rows};
  });
  for(const row of rows)await this.createOne(session,batchId,accountId,row);
  return this.read(session,batchId);
 }

 private async ownedBatch(c:PoolClient,ownerId:string,batchId:string){
  const batch=(await c.query<{account_id:string}>(`SELECT b.account_id FROM local_identity.episode_import_batches b
   JOIN public.account_memberships m ON m.account_id=b.account_id AND m.user_id=b.owner_id AND m.role='owner'
   WHERE b.owner_id=$1 AND b.id=$2`,[ownerId,batchId])).rows[0];
  if(!batch)throw new ConfigurationError(404,'导入批次不可见。');
  return batch;
 }

 private async reserve(session:OwnerSession,batchId:string,input:ImportInput){
  const items=input.items.map(itemPayload),hash=canonicalFingerprint({...input,items});
  await sessionTransaction(this.pool,session,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[session.id+':episode-import:'+batchId]);
   const saved=(await c.query('SELECT payload_hash FROM local_identity.episode_import_batches WHERE owner_id=$1 AND id=$2',[session.id,batchId])).rows[0];
   if(saved){
    await this.ownedBatch(c,session.id,batchId);
    if(saved.payload_hash!==hash)throw new ConfigurationError(409,'此批次已提交，重试时请沿用原内容。');
    return;
   }
   await ownedSeries(c,session.id,input);
   await c.query('INSERT INTO local_identity.episode_import_batches(owner_id,id,account_id,payload_hash) VALUES($1,$2,$3,$4)',[session.id,batchId,input.accountId,hash]);
   for(const [position,item] of items.entries())await c.query(`INSERT INTO local_identity.episode_import_items
    (owner_id,batch_id,item_id,position,title,source_name,payload) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [session.id,batchId,item.itemId,position,item.title,item.sourceName,{...item,seriesVersionId:input.seriesVersionId}]);
  });
 }

 private async createOne(session:OwnerSession,batchId:string,accountId:string,row:PendingImport){
  const item=row.payload;
  const ids=[session.id,batchId,item.itemId],data={accountId,seriesVersionId:item.seriesVersionId,title:item.title};
  const keyHex=fingerprint(ids.join(':')).slice(0,32);
  const key=keyHex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
  try{
   await createEpisodeDirectory(this.pool,session,key,canonicalFingerprint({batchId,item}),data,this.mediaRoot,this.preflight,{
    beforeReserve:async(c,seriesId)=>{
     const existing=await c.query('SELECT status FROM local_identity.episode_import_items WHERE owner_id=$1 AND batch_id=$2 AND item_id=$3',ids);
     if(existing.rows[0]?.status==='skipped')return false;
     if(item.duplicate==='create'||!await duplicateEpisode(c,accountId,seriesId,item.title,item.sourceSha256))return true;
     await c.query(`UPDATE local_identity.episode_import_items SET status='skipped',reason='同一账号和系列已有同标题、同脚本的生产单。',payload=NULL
      WHERE owner_id=$1 AND batch_id=$2 AND item_id=$3`,ids);
     return false;
    },
    initialize:async(c,episode)=>{
     await c.query(`INSERT INTO local_identity.episode_import_drafts(episode_id,owner_id,source_name,source_text,source_sha256,target_duration,shots)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[episode.id,session.id,item.sourceName,item.sourceText,item.sourceSha256,item.targetDuration,JSON.stringify(item.shots)]);
     await c.query(`UPDATE local_identity.episode_import_items SET episode_id=$4,status='succeeded',reason=NULL,payload=NULL
      WHERE owner_id=$1 AND batch_id=$2 AND item_id=$3`,[...ids,episode.id]);
    },
   });
  }catch(error){
   if(error instanceof EpisodeCreationSkipped)return;
   if((error as {status?:number}).status===401)throw error;
   const reason=error instanceof ConfigurationError?error.message:'生产单未能创建，请重试此批。';
   await sessionTransaction(this.pool,session,c=>c.query(`UPDATE local_identity.episode_import_items
    SET status='failed',reason=$4
    WHERE owner_id=$1 AND batch_id=$2 AND item_id=$3 AND status IN ('pending','failed')`,[...ids,reason]));
  }
 }
}
