import {cpus, freemem, totalmem, homedir} from 'node:os';
import {stat,statfs,realpath} from 'node:fs/promises';
import type {Pool} from 'pg';
import {createRuntimeVersionReader,type RuntimeVersionOptions} from './runtimeVersion.js';
import {ownerTransaction} from './ownerTransaction.js';
import {verifyMediaLibrary} from '../worker/mediaLibrary.js';
import type {RuntimeQueue, RuntimeResources, RuntimeStatus, WorkerRuntimeStatus} from '../observability/runtimeStatus.js';

export interface WorkerObservation {
  stopped: boolean; lastHeartbeatAt: string | null; lastScanAt: string | null;
  lastError: string | null; activeWorkers: number; capacity: number;
}
interface Options extends RuntimeVersionOptions {
  pool: Pool; mediaRoot: string;
  mountPath?: string; minimumFreeBytes?: number;
  worker?: () => WorkerObservation;
}
// Match the persisted operation identities used by Worker summaries. Latest task
// wins before filtering state; a completed/superseded attempt hides its old failure.
export const runtimeQueueSql = `WITH owned_tasks AS MATERIALIZED (
  SELECT t.*,e.title episode_title,
    CASE WHEN t.task_type IN ('generate_review_render','generate_final_render') THEN 'render:'||t.task_type
      WHEN nullif(btrim(t.input_snapshot#>>'{shot_preparation,draft_id}'),'') IS NOT NULL THEN 'preparation:'||(t.input_snapshot#>>'{shot_preparation,draft_id}')
      WHEN nullif(btrim(t.input_snapshot#>>'{shot_preparation,review_package_id}'),'') IS NOT NULL AND nullif(btrim(t.input_snapshot#>>'{shot_preparation,shot_id}'),'') IS NOT NULL THEN 'preparation:'||(t.input_snapshot#>>'{shot_preparation,review_package_id}')||':'||(t.input_snapshot#>>'{shot_preparation,shot_id}')
      WHEN nullif(btrim(t.input_snapshot->>'storyboard_review_package_id'),'') IS NOT NULL AND nullif(btrim(t.input_snapshot#>>'{shot,id}'),'') IS NOT NULL THEN 'shot:'||(t.input_snapshot->>'storyboard_review_package_id')||':'||(t.input_snapshot#>>'{shot,id}')
      WHEN nullif(btrim(t.input_snapshot#>>'{audio_track,source_review_package_id}'),'') IS NOT NULL AND nullif(btrim(t.input_snapshot#>>'{audio_track,cue_id}'),'') IS NOT NULL THEN 'audio:'||(t.input_snapshot#>>'{audio_track,source_review_package_id}')||':'||(t.input_snapshot#>>'{audio_track,cue_id}')
      WHEN nullif(btrim(t.input_snapshot#>>'{output,relative_path}'),'') IS NOT NULL THEN 'output:'||(t.input_snapshot#>>'{output,relative_path}')
      ELSE 'task:'||t.id END operation
  FROM public.tasks t JOIN public.episodes e ON e.id=t.episode_id
  WHERE e.archived_at IS NULL AND t.invalidated_at IS NULL
    AND NOT local_identity.is_historical_episode(e.id) AND NOT local_identity.is_historical_task(t.id)
    AND EXISTS (SELECT 1 FROM public.account_memberships m WHERE m.account_id=e.account_id AND m.user_id=$1::uuid AND m.role='owner')
), current_tasks AS MATERIALIZED (
  SELECT DISTINCT ON (episode_id,task_type,operation) * FROM owned_tasks t
  WHERE NOT EXISTS (SELECT 1 FROM owned_tasks newer WHERE newer.episode_id=t.episode_id AND newer.task_type=t.task_type
    AND newer.status='completed' AND newer.input_snapshot->>'recovered_from_task_id'=t.id::text)
  ORDER BY episode_id,task_type,operation,created_at DESC,id DESC
), active AS MATERIALIZED (
  SELECT * FROM current_tasks WHERE status IN ('running','ready','blocked','failed')
), bounds AS (
  SELECT count(*)::int total,least($2::int,greatest(1,ceil(count(*)/20.0)::int)) page,
    count(*) FILTER(WHERE status='running')::int running,count(*) FILTER(WHERE status='ready')::int queued,
    count(*) FILTER(WHERE status='blocked')::int blocked,count(*) FILTER(WHERE status='failed')::int failed FROM active
), items AS (
  SELECT * FROM active ORDER BY CASE WHEN status IN ('blocked','failed') THEN 0 WHEN status='running' THEN 1 ELSE 2 END,created_at,id
  LIMIT 20 OFFSET ((SELECT page FROM bounds)-1)*20
)
SELECT jsonb_build_object('total',total,'page',page,'pageSize',20,'running',running,'queued',queued,'blocked',blocked,'failed',failed,
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'episodeId',episode_id,'episodeTitle',episode_title,'taskType',task_type,
    'status',status,'createdAt',created_at,'claimedAt',claimed_at,'availableAt',CASE WHEN isfinite(available_at) THEN available_at END)
    ORDER BY CASE WHEN status IN ('blocked','failed') THEN 0 WHEN status='running' THEN 1 ELSE 2 END,created_at,id) FROM items),'[]')) queue FROM bounds`;

export function observeWorker(source: WorkerObservation | undefined, at: number): WorkerRuntimeStatus {
  if (!source) return {state:'unknown',heartbeatAt:null,lastScanAt:null,active:null,capacity:null,problem:'本机 Worker 未配置。'};
  const elapsed = source.lastHeartbeatAt ? at-Date.parse(source.lastHeartbeatAt) : Infinity;
  const offline = source.stopped || elapsed > 15000 || elapsed < 0;
  const staleScan = !source.lastScanAt || at-Date.parse(source.lastScanAt)>30000;
  return {state:offline?'offline':source.lastError||staleScan?'attention':'healthy',heartbeatAt:source.lastHeartbeatAt,lastScanAt:source.lastScanAt,
    active:source.activeWorkers,capacity:source.capacity,
    problem:offline?'Worker 心跳已中断，请检查本机服务。':source.lastError||staleScan?'Worker 调度检查未完成，请检查本机日志。':null};
}
const cpuTimes = () => cpus().reduce((sum,cpu) => ({idle:sum.idle+cpu.times.idle,total:sum.total+Object.values(cpu.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});

export function createRuntimeStatusReader(options: Options) {
  const version=createRuntimeVersionReader(options);
  let previousCpu=cpuTimes();
  let resourceCache: {at:number; value:Promise<RuntimeResources>} | undefined;
  function resources() {
    const at=Date.now();
    if(resourceCache && at-resourceCache.at<2500)return resourceCache.value;
    const value=(async():Promise<RuntimeResources>=>{
      const cpu=cpuTimes(),total=cpu.total-previousCpu.total,idle=cpu.idle-previousCpu.idle;previousCpu=cpu;
      const [disk,systemDisk,media]=await Promise.all([
        statfs(options.projectRoot).then(fs=>({availableBytes:fs.bavail*fs.bsize,totalBytes:fs.blocks*fs.bsize,sourcePath:options.projectRoot})).catch(()=>null),
        Promise.all([statfs(homedir()),stat(homedir()),realpath(homedir())])
          .then(([fs,identity,sourcePath])=>({availableBytes:fs.bavail*fs.bsize,totalBytes:fs.blocks*fs.bsize,sourcePath,deviceId:identity.dev})).catch(()=>null),
        options.mountPath ? (async()=>{
          await verifyMediaLibrary({mediaRootBinding:(await options.pool.query("SELECT local_identity.media_deployment()->'binding' binding")).rows[0].binding,assetRoot:options.mediaRoot,mountPath:options.mountPath!,minimumFreeBytes:0,requireEpisodesDirectory:false,allowMountRoot:true});
          const [fs,identity,sourcePath]=await Promise.all([statfs(options.mediaRoot),stat(options.mediaRoot),realpath(options.mediaRoot)]);
          const availableBytes=fs.bavail*fs.bsize;
          return {state:availableBytes<(options.minimumFreeBytes??0)?'attention' as const:'healthy' as const,availableBytes,totalBytes:fs.blocks*fs.bsize,minimumFreeBytes:options.minimumFreeBytes??0,sourcePath,mountPath:options.mountPath!,deviceId:identity.dev};
        })().catch(()=>({state:'offline' as const,availableBytes:null,totalBytes:null,minimumFreeBytes:options.minimumFreeBytes??0,sourcePath:options.mediaRoot,mountPath:options.mountPath!,deviceId:null}))
          : Promise.resolve({state:'unknown' as const,availableBytes:null,totalBytes:null,minimumFreeBytes:null,sourcePath:options.mediaRoot,mountPath:null,deviceId:null}),
      ]);
      const {deviceId:mediaDevice,...mediaStatus}=media;
      return {cpuPercent:total>0?Math.round(100*Math.max(0,Math.min(1,1-idle/total))):null,memory:{totalBytes:totalmem(),freeBytes:freemem()},
        disk,
        systemDisk:systemDisk?{availableBytes:systemDisk.availableBytes,totalBytes:systemDisk.totalBytes,sourcePath:systemDisk.sourcePath}:null,
        media:{...mediaStatus,sameVolume:systemDisk&&mediaDevice!=null?systemDisk.deviceId===mediaDevice:null}};
    })();resourceCache={at,value};return value;
  }
  return async(ownerId: string, page=1):Promise<RuntimeStatus>=>{
    const [queue,resourceStatus,versionStatus]=await Promise.all([
      ownerTransaction(options.pool,ownerId,true,async client=>{
        await client.query("SET LOCAL statement_timeout='3000ms'");
        return (await client.query(runtimeQueueSql,[ownerId,page])).rows[0].queue as RuntimeQueue;
      }).catch(()=>null),
      resources().catch(()=>null),
      version(),
    ]);
    const observedAt=new Date().toISOString();
    return {observedAt,version:versionStatus,worker:observeWorker(options.worker?.(),Date.parse(observedAt)),queue,resources:resourceStatus};
  };
}
