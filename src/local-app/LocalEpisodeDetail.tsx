import {useEffect,useMemo,useState} from 'react';
import {EpisodeProductionView} from '../episodes/EpisodeProduction';
import type {EpisodeProductionSnapshot} from '../episodes/EpisodeProductionContainer';
import {createEpisodeReader} from '../episodes/episodeReadService';
import {localCommand,localRequest} from './client';
import type {WorkerPreflightResult} from '../worker/contracts';
export function LocalEpisodeDetail({episodeId,onClose,onChanged}:{episodeId:string;onClose:()=>void;onChanged:()=>Promise<void>}){
 const [snapshot,setSnapshot]=useState<EpisodeProductionSnapshot|null>(null),[error,setError]=useState(''),[pending,setPending]=useState('');
 const [preflight,setPreflight]=useState<WorkerPreflightResult|null>(null);
 const reader=useMemo(()=>createEpisodeReader<EpisodeProductionSnapshot>(async(id,known)=>localRequest(`episodes/${id}?known=${encodeURIComponent(JSON.stringify(known))}`)),[episodeId]);
 async function refresh(){const next=await reader(episodeId);setSnapshot(next);}
 useEffect(()=>{let current=true,busy=false;async function poll(){if(busy||document.hidden)return;busy=true;try{const s=await reader(episodeId);if(current)setSnapshot(s);}catch(e){if(current)setError(e instanceof Error?e.message:String(e));}finally{busy=false;}}void poll();const timer=setInterval(()=>void poll(),2000);document.addEventListener('visibilitychange',poll);return()=>{current=false;clearInterval(timer);document.removeEventListener('visibilitychange',poll);};},[episodeId,reader]);
 async function command(name:string,data:unknown){setPending(name);setError('');setPreflight(null);try{const result=await localCommand(name,data,undefined,'episode-commands');await refresh();await onChanged();return result;}catch(e){setError(e instanceof Error?e.message:String(e));if(e&&typeof e==='object'&&'preflight'in e)setPreflight(e.preflight as WorkerPreflightResult);throw e;}finally{setPending('');}}
 const unavailable=async()=>{throw Error('此操作尚未在本地服务接管。');};
 return <section><button className="button" onClick={onClose}>返回生产单目录</button>{error&&<p role="alert">{error}</p>}{snapshot?<>{snapshot.episode.stage==='visual_approved'&&<button className="button button-primary" disabled={Boolean(pending)} onClick={()=>{void command('planStoryboard',{episodeId}).catch(()=>{});}}>规划分镜</button>}<EpisodeProductionView key={snapshot.episode.stage} {...snapshot} productionPreflight={preflight} isMaterialPending={pending==='importMaterial'} isStartProductionPending={pending==='start'} isTransitionPending={pending==='review'} isStoryboardAnnotationPending={pending==='annotateStoryboard'}
 onCreateAudioTrackAnnotation={unavailable} onCreateStoryboardAnnotation={async input=>{await command('annotateStoryboard',{...input,episodeId});}} onRequestRevision={unavailable}
 onRequestShotStructureRevision={async input=>{await command('requestStructureRevision',input);}}
 onSaveShotPreparationDraft={unavailable} onSaveEpisodeTtsSettings={unavailable} onSaveStoryboardAudioSelection={unavailable} onRegisterManualMedia={unavailable}
 onGenerateShotTts={unavailable} onGenerateShotSyncPreview={unavailable} onConfirmShotSyncPreview={unavailable} onGenerateShotReviewVideo={unavailable} onOpenStudio={unavailable}
 onRefresh={refresh} onOpenLocalDirectory={async()=>{await command('openDirectory',{episodeId});}} isDirectoryOpenPending={pending==='openDirectory'}
 onImportMaterial={async input=>{let binary='';for(const byte of input.content??[])binary+=String.fromCharCode(byte);const result=await command('importMaterial',{...input,content:undefined,contentBase64:btoa(binary)}) as {id:string};return result.id;}}
 onStartProduction={async()=>{await command('start',{episodeId});}}
 onTransition={async(_id,toStage,reason)=>{try{const stage=toStage.startsWith('storyboard_')?'storyboard_review':'visual_review';const review=snapshot.reviewPackages.filter(p=>p.stage===stage&&!p.invalidated_at).sort((a,b)=>b.revision_number-a.revision_number)[0];await command('review',{episodeId,toStage,reason,reviewPackageId:review?.id});return true;}catch{return false;}}}
 /></>:<p role="status">正在加载生产单…</p>}</section>;
}
