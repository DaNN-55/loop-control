import {useCallback,useEffect,useRef,useState} from 'react';
import {uiText} from '../i18n/ui';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import type {EmbeddedStudioBridge,EmbeddedStudioToolTarget} from './EmbeddedStudioHost';
import {WorkspaceAudioPreparation} from './WorkspaceAudioPanel';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {WorkspaceCaptionsPanel} from './WorkspaceCaptionsPanel';
import type {VideoInputMaterial} from './WorkspaceVideoInputs';
interface Props {
 workspace:ProductionWorkspace;bridge:EmbeddedStudioBridge;target:EmbeddedStudioToolTarget;
 command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void;
 onBusyChange?:(busy:boolean)=>void;materials?:Array<VideoInputMaterial&{material_purpose?:string|null}>;importFile?:File;
}
/** Only preparation and acoustic alignment supplement the native editor. */
export function EmbeddedStudioTools({workspace,bridge,target,command,onChange,materials=[],importFile,onBusyChange}:Props){
 const mounted=useRef(true),busyListener=useRef(onBusyChange),busyParts=useRef({import:false,content:false});busyListener.current=onBusyChange;
 const reportContentBusy=useCallback((busy:boolean)=>{busyParts.current.content=busy;busyListener.current?.(busyParts.current.import||busy);},[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;busyListener.current?.(false);};},[]);
 const pendingImport=useRef<{file:File;material:{id:string;storage_path:string}}|null>(null);
 const [imported,setImported]=useState<File|null>(null),[uploading,setUploading]=useState(false),[localMaterials,setLocalMaterials]=useState<NonNullable<Props['materials']>>([]);
 const allMaterials=[...materials,...localMaterials.filter(value=>!materials.some(known=>known.id===value.id))];
 const [project,setProject]=useState<OpenChatCutProject|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!bridge.connected)return;
  let active=true;setError('');
  void bridge.inspect().then(value=>{if(active)setProject(value.document);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'无法读取原生工程。');});
  return()=>{active=false;};
 },[bridge.connected,bridge.selectedItemId,workspace.project.sha256,target]);
 async function importSelectedFile(){
  if(!importFile||uploading)return;
  busyParts.current.import=true;busyListener.current?.(true);setUploading(true);setError('');
  try{
   const kind=/\.(png|jpe?g|webp|bmp)$/i.test(importFile.name)?'image':/\.(mp4|mov|webm)$/i.test(importFile.name)?'video':null;
   const max=100*1024*1024;
   if(!kind||!importFile.size||importFile.size>max||importFile.type&&!importFile.type.startsWith(kind+'/'))throw Error('素材格式、类型或大小不符合导入要求。');
   await bridge.save();
   let result=pendingImport.current?.file===importFile?pendingImport.current.material:null;
   if(!result){
    const contentBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('素材读取失败。'));reader.readAsDataURL(importFile);});
    result=await command('importMaterial',{episodeId:workspace.episodeId,materialType:kind,sourceKind:'file',sourcePath:importFile.name,mimeType:importFile.type||(kind==='image'?'image/'+(/\.jpe?g$/i.test(importFile.name)?'jpeg':importFile.name.split('.').pop()?.toLowerCase()):/\.mov$/i.test(importFile.name)?'video/quicktime':/\.webm$/i.test(importFile.name)?'video/webm':'video/mp4'),contentBase64,isMainScript:false,materialPurpose:'visual_reference'}) as {id:string;storage_path:string};
    pendingImport.current={file:importFile,material:result};
    const material=result;setLocalMaterials(values=>[...values,{id:material.id,storage_path:material.storage_path,material_type:kind,source_path:importFile.name,material_purpose:'visual_reference'}]);
   }
   const response=await fetch(`/api/local/episodes/${workspace.episodeId}/workspace`);
   if(!response.ok)throw Error('无法读取导入后的工程版本。');
   const current=(await response.json()).workspace as ProductionWorkspace;
   if(current?.id!==workspace.id||current.episodeId!==workspace.episodeId)throw Error('工程访问已变化，请重新打开。');
   const identity={episodeId:current.episodeId,workspaceId:current.id,expectedRevision:current.revision};
   if(bridge.selectedItemId&&bridge.selectedShotId){
    onChange(await command('registerWorkspaceVisualCandidate',{...identity,targetItemId:bridge.selectedItemId,materialRevisionId:result.id,usage:kind==='video'?'video':'still',durationSeconds:3}) as ProductionWorkspace);
   }
   setImported(importFile);

  }catch(cause){setError(cause instanceof Error?cause.message:'素材导入未完成。');}finally{busyParts.current.import=false;if(mounted.current){busyListener.current?.(busyParts.current.content);setUploading(false);}}
 }
 const selected=project?.timelines.flatMap(t=>t.items).find(item=>item.id===bridge.selectedItemId),binding=workspace.clips.find(clip=>clip.itemId===bridge.selectedItemId);
 const asset=project?.assets?.find(asset=>asset.id===selected?.sourceAssetId) as {sourceContentHash?:string}|undefined;
 const sourceHash=typeof selected?.sourceContentHash==='string'?selected.sourceContentHash:asset?.sourceContentHash;
 const sourceCandidate=selected?workspace.visualCandidates?.find(candidate=>{
  if(candidate.kind!==selected.kind)return false;
  const sameAsset=selected.sourceAssetId===`candidate-${candidate.id}`||!!candidate.materialRevisionId&&selected.sourceAssetId===`material-${candidate.materialRevisionId}`;
  return sameAsset?(!sourceHash||candidate.sha256===sourceHash):candidate.targetItemId===selected.id&&!!sourceHash&&candidate.sha256===sourceHash;
 }):undefined;
 const bindingMatches=selected&&binding?.source&&binding.source.kind===selected.kind&&(sourceHash?binding.source.sha256===sourceHash:binding.source.relativePath===selected.src||!!binding.source.materialRevisionId&&selected.sourceAssetId===`material-${binding.source.materialRevisionId}`);
 const currentSource=sourceCandidate?{relativePath:sourceCandidate.relativePath,sha256:sourceCandidate.sha256,materialRevisionId:sourceCandidate.materialRevisionId}:bindingMatches?binding?.source:undefined;
 return <div className="embedded-studio-tool-content">
  {importFile&&target==='visual'&&<div className="embedded-studio-import"><span>{importFile.name}</span>{imported===importFile?<span role="status">{uiText('已登记为候选，明确采用后才进入时间线。')}</span>:<button type="button" disabled={uploading||!bridge.connected} onClick={()=>void importSelectedFile()}>{uiText(uploading?'导入中…':'导入所选文件')}</button>}</div>}
  {error&&<p role="alert">{uiText(error)}</p>}
  {target==='audio'?<WorkspaceAudioPreparation workspace={workspace} command={command} onChange={onChange} materials={allMaterials} project={project} bridge={bridge} selectedShotId={bridge.selectedShotId} pendingImportFile={importFile&&/\.mp3$/i.test(importFile.name)?importFile:undefined} studioTools onBusyChange={reportContentBusy}/>:
   target==='captions'?<WorkspaceCaptionsPanel workspace={workspace} command={command} onChange={onChange} bridge={bridge} selectedShotId={bridge.selectedShotId} alignmentOnly/>:
   bridge.selectedShotId?<WorkspaceVisualPreparation workspace={workspace} command={command} onChange={onChange} materials={allMaterials} project={project} bridge={bridge} onBusyChange={reportContentBusy} selectedShotId={bridge.selectedShotId} selectedTargetItemId={bridge.selectedItemId} onTargetChange={itemId=>{void bridge.selectItem?.(itemId).catch(cause=>setError(cause instanceof Error?cause.message:'无法切换原生片段。'));}} currentVisualKind={typeof selected?.kind==='string'?selected.kind:undefined} currentVisualPath={currentSource?.relativePath} currentVisualSha256={currentSource?.sha256} currentMaterialRevisionId={currentSource?.materialRevisionId}/>:<p>{uiText('先在时间线选择需要补充画面的片段。')}</p>}
 </div>;
}
