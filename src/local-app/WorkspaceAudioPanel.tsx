import {Save} from 'lucide-react';
import {WorkspaceComposerSetting} from './WorkspaceGenerationComposer';
import {soundIntentQuery} from '../soundIntent';
import {canUseWorkspaceAudioMaterial} from './workspaceAudioMaterial';
import {WorkspaceMaterialDrop} from './WorkspaceMaterialDrop';
import {WorkspaceAudioRecord} from './WorkspaceSoundRecords';
import {WorkspaceVisualTaskStatus} from './WorkspaceVisualTaskStatus';
import {reconcileWorkspaceOutput} from './workspaceOutputReconciliationClient';
import {WorkspaceAudioAudition} from './WorkspaceAudioAudition';
import {useEffect,useRef,useState} from 'react';
import {useWorkspaceReading,useWorkspacePolling} from './useWorkspaceReading';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Toggle} from '../ui/dan-ui/components/base/toggle/toggle';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import type {ProductionService} from '../connections/serviceCatalog';
import {useProductionServiceCatalog} from './useProductionServiceCatalog';
import type {ProductionSelection} from '../productionSelection';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {readWorkspaceAudioMix,type WorkspaceAudioEdit,type WorkspaceVoiceMode} from '../workspaceAudio';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import './workspace-audio.css';
import './workspace-feature-switch.css';
import './workspace-generation-composer.css';
type Command=(name:string,data:unknown)=>Promise<unknown>;
interface Props {readOnly?:boolean;workspace:ProductionWorkspace;command:Command;onChange:(workspace:ProductionWorkspace)=>void;materials?:Array<{id:string;material_type:string;source_path:string;material_purpose?:string|null}>;project?:OpenChatCutProject|null;bridge?:EmbeddedStudioBridge;selectedShotId?:string}
type AudioDraft={inputMode?:'search'|'upload';prompt?:string;selection?:ProductionSelection|null;kind:'bgm'|'sfx'|'source';description:string;query:string;manual:string;sourceItem:string;duration:number;anchor:'absolute'|'shot';offset:number;shot:string};
const emptyAudioDraft=():AudioDraft=>({kind:'bgm',description:'整期配乐',query:'',manual:'',sourceItem:'',duration:1,anchor:'absolute',offset:0,shot:''});
export function WorkspaceAudioPreparation(props:Props){
 return props.readOnly?<WorkspaceAudioRecord workspace={props.workspace} project={props.project} selectedShotId={props.selectedShotId}/>:<EditableWorkspaceAudioPreparation {...props}/>;
}
function EditableWorkspaceAudioPreparation({workspace:w,command,onChange,materials=[],project,bridge,selectedShotId,readOnly=false}:Props){
 const key=w.id+':'+(selectedShotId??'episode'),initial=():AudioDraft=>{const empty=emptyAudioDraft();try{const stored=sessionStorage.getItem(`loop-audio-draft-v2:${key}`),saved=JSON.parse(stored??sessionStorage.getItem(`loop-audio-draft:${key}`)??'{}');return {...empty,...(['bgm','source'].includes(saved.kind)||stored&&saved.kind==='sfx'?saved:{})};}catch{return empty;}};
 const [uploadStatus,setUploadStatus]=useState('');
 const [audioSetting,setAudioSetting]=useState<'source'|'anchor'|'offset'|'duration'|null>(null);
 const [musicSettingsSaved,setMusicSettingsSaved]=useState(false);
 const [drafts,setDrafts]=useState<Record<string,AudioDraft>>({}),[uploaded,setUploaded]=useState<NonNullable<Props['materials']>>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[defaultSaved,setDefaultSaved]=useState(false),[live,setLive]=useState<OpenChatCutProject|null>(null);
 const doc=bridge?live:project;
 const unique=w.clips.filter((clip,index,clips)=>clips.findIndex(other=>other.shotId===clip.shotId)===index);
 const shotIds=Object.fromEntries(unique.map(clip=>[clip.shotId,w.clips.filter(other=>other.shotId===clip.shotId).map(other=>other.itemId)]));
 const localDraft=drafts[key]??initial();
 const kind=localDraft.kind==='sfx'?'sfx':'bgm';
 const musicKey=w.id+':episode-music';
 function initialMusic():AudioDraft{try{const stored=sessionStorage.getItem(`loop-audio-draft-v2:${musicKey}`);if(stored)return {...emptyAudioDraft(),...JSON.parse(stored)};}catch{/* Retain saved production-order settings. */}const saved=w.audio?.defaults?.settings;return saved?{...emptyAudioDraft(),description:saved.description,query:saved.query,manual:saved.materialRevisionId}:localDraft.kind==='bgm'?localDraft:emptyAudioDraft();}
 const draft=kind==='bgm'?(drafts[musicKey]??initialMusic()):localDraft;
 useEffect(()=>{if(kind==='bgm')try{sessionStorage.setItem(`loop-audio-draft-v2:${musicKey}`,JSON.stringify(draft));}catch{/* Keep the live draft. */}},[kind,musicKey,draft]);
 const {description,query,duration,anchor,offset}=kind===draft.kind?draft:emptyAudioDraft();
 const enabled=w.audio?.enabled?.[kind]!==false;
 const selection=draft.selection===undefined?w.audio?.defaults?.selection:draft.selection;
 const shot=(selectedShotId??draft.shot)||unique[0]?.shotId||'';
 const audioPurpose=kind==='sfx'?'sound_effect':'background_music';
 const eligibleMaterials=[...materials,...uploaded.filter(m=>!materials.some(known=>known.id===m.id))]
  .filter(m=>m.material_type==='audio'&&canUseWorkspaceAudioMaterial(m.material_purpose,audioPurpose));
 const inputMode=draft.inputMode??(draft.manual?'upload':'search');
 const selectedMaterial=eligibleMaterials.find(m=>m.id===draft.manual);
 const manual=inputMode==='upload'?selectedMaterial?.id??'':'';
 const catalogReading=useProductionServiceCatalog({scope:JSON.stringify([w.episodeId,w.id])});
 const services=catalogReading.catalog?.groups.find(g=>g.capability==='music_sound')?.services??[],catalogError=catalogReading.error?'无法读取音频连接，请刷新服务后重试。':'';
 const service=services.find(s=>s.connectionVersionId===selection?.connectionVersionId&&s.provider===selection?.provider&&s.adapter===selection?.adapter);
 function change(patch:Partial<AudioDraft>){setMusicSettingsSaved(false);if(Object.hasOwn(patch,'selection'))setDefaultSaved(false);const target=Object.hasOwn(patch,'kind')?key:kind==='bgm'?musicKey:key;setDrafts(values=>{const next={...(values[target]??(target===musicKey?initialMusic():initial())),...patch};try{sessionStorage.setItem(`loop-audio-draft-v2:${target}`,JSON.stringify(next));}catch{/* Keep the live form. */}return {...values,[target]:next};});}
 const intentShot=w.clips.find(clip=>clip.shotId===shot);
 const prompt=draft.prompt??(kind==='sfx'?draft.query||intentShot?.soundIntent||'':query);
 const soundQuery=soundIntentQuery(prompt);
 const input=useRef<HTMLInputElement>(null),current=useRef(w);current.current=w;
 const reading=useWorkspaceReading(w,onChange,selectedShotId??'episode','无法读取当前工程版本。');
 useWorkspacePolling(reading,!!w.audio?.preparations.some(p=>p.taskId&&['ready','running'].includes(p.status)),3000,undefined,
  value=>command('refreshWorkspaceAudio',{episodeId:value.episodeId,workspaceId:value.id,expectedRevision:value.revision}) as Promise<ProductionWorkspace>);
 useEffect(()=>{if(!bridge?.connected)return;let active=true;void bridge.inspect().then(value=>{if(active)setLive(value.document);}).catch(()=>{});return()=>{active=false;};},[bridge?.connected,w.project.sha256]);
 async function savedWorkspace(){if(!bridge)return current.current;await bridge.save();return reading.read();}
 async function run(name:string,extra:Record<string,unknown>){setBusy(true);setError('');try{const saved=await savedWorkspace();reading.publish(await command(name,{episodeId:saved.episodeId,workspaceId:saved.id,expectedRevision:saved.revision,...extra}) as ProductionWorkspace);return true;}catch(e){if(!(e instanceof Error&&e.name==='AbortError'))setError(e instanceof Error?e.message:'音频准备未完成。');return false;}finally{setBusy(false);}}
 function musicSelection(chosen:ProductionService):ProductionSelection{
  return {capability:'music_sound',provider:chosen.provider,adapter:chosen.adapter,
   ...(chosen.connectionVersionId?{connectionVersionId:chosen.connectionVersionId}:{})};
 }
 async function saveMusicDefaults(){
  if(!service?.executable||busy)return;
  if(await run('saveWorkspaceAudioDefaults',{selection:musicSelection(service)})){change({selection:undefined});setDefaultSaved(true);}
 }
 async function upload(file:File){setBusy(true);setError('');setUploadStatus(`正在读取 ${file.name}…`);try{
  if(!file.size||file.size>100*1024*1024)throw Error('声音素材不能为空或超过100MB。');if(!/\.mp3$/i.test(file.name)||file.type&&!['audio/mpeg','audio/mp3'].includes(file.type))throw Error('请选择 MP3 声音素材。');
  if(bridge)await bridge.save();const contentBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败，请重新选择。'));reader.onabort=()=>reject(Error('文件读取已取消。'));reader.readAsDataURL(file);});
  setUploadStatus(`正在上传 ${file.name}…`);
  const result=await command('importMaterial',{episodeId:w.episodeId,materialType:'audio',sourceKind:'file',sourcePath:file.name,mimeType:'audio/mpeg',contentBase64,isMainScript:false,materialPurpose:audioPurpose}) as {id:string};
  setUploaded(rows=>[...rows,{id:result.id,material_type:'audio',source_path:file.name,material_purpose:audioPurpose}]);change({manual:result.id,inputMode:'upload'});setUploadStatus(`已选中 ${file.name}，可继续准备声音。`);
 }catch(cause){setUploadStatus('');setError(cause instanceof Error?cause.message:'声音素材登记未完成。');}finally{setBusy(false);}}
 const mix=doc?readWorkspaceAudioMix(doc,shotIds):w.audio?.mix;
 const activeTimeline=doc?.timelines.find(t=>t.id===doc.activeTimelineId),episodeDuration=activeTimeline?Math.max(0,...activeTimeline.items.filter(i=>['video','image','text','sequence'].includes(String(i.kind))).map(i=>(Number(i.startFrame)+Number(i.durationInFrames))/activeTimeline.fps)):duration;
 const disabled=readOnly||busy||w.stale||!!bridge&&!bridge.connected,preparations=(w.audio?.preparations??[]).filter(p=>p.kind!=='bgm'&&p.kind!=='sfx'||w.audio?.enabled?.[p.kind]!==false);
 const effects=preparations.filter(p=>p.kind==='sfx'&&(!selectedShotId||p.anchor==='shot'&&p.shotId===selectedShotId)),absoluteEffects=selectedShotId?preparations.filter(p=>p.kind==='sfx'&&p.anchor==='absolute'):[],other=preparations.filter(p=>p.kind!=='sfx'&&(p.kind==='bgm'||!selectedShotId||p.shotId===selectedShotId));
 async function applySound(edit:WorkspaceAudioEdit){setBusy(true);setError('');try{if(bridge)setLive(await bridge.applyNativeEdit('apply-audio-mix',{edit}));else{const saved=current.current;reading.publish(await command('mixWorkspaceAudio',{episodeId:saved.episodeId,workspaceId:saved.id,expectedRevision:saved.revision,edit}) as ProductionWorkspace);}}catch(cause){setError(cause instanceof Error?cause.message:'音效修改未保存。');}finally{setBusy(false);}}
 async function reconcile(p:typeof preparations[number],recover=false){setBusy(true);setError('');try{if(recover&&p.generationTask)await reconcileWorkspaceOutput(w.episodeId,p.generationTask);reading.publish(await reading.read());}catch(cause){setError(cause instanceof Error?cause.message:'音频状态未能核对，请重试。');}finally{setBusy(false);}}
 function candidate(p:typeof preparations[number]){
  const sound=p.kind==='sfx'?mix?.sounds.find(s=>s.itemId===p.adoptedItemId):undefined,ready=['completed','ready'].includes(p.status)&&(!p.taskId||p.status==='completed');
  const timeline=doc?.timelines.find(t=>t.items.some(i=>shotIds[p.shotId??'']?.includes(String(i.id)))),start=timeline?Math.min(...timeline.items.filter(i=>shotIds[p.shotId??'']?.includes(String(i.id))).map(i=>Number(i.startFrame)/timeline.fps)):null;
  const offsetSeconds=sound&&p.anchor==='shot'&&start!==null?sound.startSeconds-start:p.offsetSeconds;
  return <div className="workspace-audio-candidate" key={p.id}>
   <div className="workspace-audio-candidate-row">
   <div className="workspace-audio-candidate-summary"><strong title={[p.source?.title??p.description,p.connection?`${p.connection.name} v${p.connection.version} · ${p.selection?.provider} · 检索：${p.query}`:p.source?.provider==='manual'?'人工来源':null].filter(Boolean).join('\n')}>{p.source?.provider==='freesound'?String(p.source.title??p.description):p.description}</strong><span>{p.kind==='bgm'?'整期':p.kind==='source'?'原片':p.anchor==='shot'?`${selectedShotId?'':p.shotId+' · '}+${offsetSeconds.toFixed(2)} 秒`:`整期 ${sound?.startSeconds??p.offsetSeconds} 秒`} · {sound?'已加入':p.generationTask?.publicationAttempt!=null?'发布待核对':p.status==='completed'||!p.taskId?'可用':p.status==='ready'||p.status==='running'?'准备中':p.status==='failed'?'失败':p.status==='blocked'?'待重试':p.status}{p.kind==='sfx'?` · ${(sound?.durationSeconds??p.durationSeconds).toFixed(2)} 秒`:''}</span></div>
   {p.relativePath&&<WorkspaceAudioAudition label={p.source?.title?String(p.source.title):p.description} showControls={false} aria-label={`${p.description}试听`} preload="none" src={`/_local-artifact?episode=${w.episodeId}&path=${encodeURIComponent(p.relativePath)}&sha256=${p.sha256}`}/>}
   <div className="workspace-audio-actions">{p.source?.provider==='freesound'&&<><a className="workspace-audio-creator" title={String(p.source.creator)} href={String(p.source.sourceUrl)} target="_blank" rel="noreferrer">{String(p.source.creator)}</a><a href={String(p.source.license)} target="_blank" rel="noreferrer">许可</a></>}
    {ready&&!sound&&<Button size="sm" color="secondary" isDisabled={disabled||!!bridge} onPress={()=>void run('adoptWorkspaceAudio',{preparationId:p.id})}>{p.kind==='sfx'?p.anchor==='shot'?'加入镜头':'加入时间线':p.adoptedItemId?'重新采用':'采用'}</Button>}
    {['failed','blocked'].includes(p.status)&&p.generationTask?.publicationAttempt==null&&!p.generationTask?.submissionUnknown&&<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void run('prepareWorkspaceAudio',{kind:p.kind,preparationId:p.id,retry:true})}>重试原音频准备</Button>}
   </div>
   </div>
   {p.generationTask&&(p.generationTask.publicationAttempt!=null||p.generationTask.submissionUnknown)&&<WorkspaceVisualTaskStatus task={p.generationTask} label="音频" taskNoun="音频任务" resumeLabel="恢复音频任务" disabled={disabled} onRefresh={()=>void reconcile(p)} onReconcile={()=>void reconcile(p,true)} onResume={()=>{}}/>}
   {sound&&<SoundRow key={sound.itemId+JSON.stringify(sound)} sound={sound} workspaceId={w.id} disabled={disabled} apply={applySound} summary={false}/>}{p.error&&<p role="alert">{p.error}</p>}
  </div>;
 }
 return <section className="workspace-audio workspace-audio-preparation" aria-label="配乐与声音准备">
  <header className="workspace-narration-toolbar">
   <div className="workspace-visual-preview-tabs" role="group" aria-label="声音类型">{([['sfx','音效'],['bgm','整期配乐']] as const).map(([next,label])=><button key={next} type="button" aria-pressed={kind===next} disabled={disabled} onClick={()=>{if(next!==kind)change({kind:next,description:next==='bgm'?'整期配乐':'导入音效',...(next==='sfx'?{anchor:'shot',shot:selectedShotId??w.clips[0]?.shotId??''}:{anchor:'absolute'})});}}>{label}</button>)}</div>
   <Toggle className="workspace-feature-switch" size="sm" label={enabled?'已开启':'已关闭'} aria-label={kind==='bgm'?'启用整期配乐':'启用音效'} isSelected={enabled} isDisabled={disabled} onChange={value=>void run('setWorkspaceAudioEnabled',{kind,enabled:value})}/>
  </header>
  <div hidden={!enabled} className="workspace-audio-enabled-content">
  <div className="workspace-generation-composer workspace-audio-composer" data-audio-kind={kind}>
   <div className="workspace-audio-composer-input workspace-audio-single-input">
    {inputMode==='search'?<label>{kind==='sfx'?'音效意图或检索词':'配乐检索词'}<textarea aria-label={kind==='sfx'?'音效意图或检索词':'英文检索词'} rows={5} maxLength={kind==='sfx'?240:100} value={prompt} disabled={disabled} placeholder={kind==='sfx'?'描述需要的声音，例如：开门时一声轻响；也可输入 door creak':'输入英文检索词，例如：calm ambient piano'} onChange={event=>change({prompt:event.target.value,...(kind==='bgm'?{query:event.target.value}:{})})}/></label>:<div className="workspace-audio-upload-slot">
     <WorkspaceMaterialDrop label={kind==='sfx'?'拖入音效':'拖入配乐'} kind="audio" purpose={audioPurpose} surface="preview" persistent disabled={disabled} selectedName={selectedMaterial?.source_path.split('/').pop()} onSelect={id=>change({manual:id,inputMode:'upload'})} onBrowse={!bridge?()=>input.current?.click():undefined} onFiles={!bridge?files=>{if(files[0])void upload(files[0]);}:undefined}/>
     <input ref={input} aria-label={kind==='sfx'?'上传音效':'上传配乐'} hidden type="file" accept=".mp3,audio/mpeg" disabled={disabled} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(file);}}/>
     <label>本地音频<NativeSelect size="sm" aria-label="本地音频" value={selectedMaterial?.id??''} disabled={disabled} onChange={event=>change({manual:event.target.value})}><option value="">选择已导入音频</option>{eligibleMaterials.map(m=><option key={m.id} value={m.id}>{m.source_path.split('/').pop()}</option>)}</NativeSelect></label>
     {manual&&<Button size="xs" color="tertiary" isDisabled={disabled} onPress={()=>change({manual:''})}>清除选择</Button>}{uploadStatus&&<span role="status">{uploadStatus}</span>}
    </div>}
   </div>
   <div className="workspace-composer-toolbar workspace-audio-submit workspace-audio-composer-toolbar">
    <WorkspaceComposerSetting label="音频来源" summary={inputMode==='upload'?'上传音频':service?.connectionName??'Freesound'} open={audioSetting==='source'} onOpenChange={open=>setAudioSetting(open?'source':null)} disabled={disabled}>
     <label>来源<NativeSelect size="sm" aria-label="音频来源类型" value={inputMode==='upload'?'upload':service?.id??''} disabled={disabled} onChange={event=>{if(event.target.value==='upload')change({inputMode:'upload'});else{const chosen=services.find(item=>item.id===event.target.value);change({inputMode:'search',selection:chosen?musicSelection(chosen):null});}}}><option value="">选择检索服务</option>{services.map(item=><option key={item.id} value={item.id} disabled={!item.executable}>{item.connectionName??item.label} · Freesound</option>)}<option value="upload">上传音频</option></NativeSelect></label>
     <label>用途<input value={description} maxLength={100} disabled={disabled} onChange={event=>change({description:event.target.value})}/></label>
     {inputMode==='search'&&<div className="workspace-audio-default"><Button size="sm" color="tertiary" isDisabled={disabled} onPress={catalogReading.refresh}>刷新服务</Button><Button size="sm" color="secondary" isDisabled={disabled||!service?.executable} onPress={()=>void saveMusicDefaults()}>设为本期默认</Button></div>}
     {catalogError&&<p role="alert">{catalogError}</p>}{defaultSaved&&<span role="status">本期默认已保存</span>}
    </WorkspaceComposerSetting>
    {kind==='sfx'&&<>
     <WorkspaceComposerSetting compact label="音效定位方式" summary={anchor==='shot'?'跟随镜头':'固定时间线'} open={audioSetting==='anchor'} onOpenChange={open=>setAudioSetting(open?'anchor':null)} disabled={disabled}>    <label title={anchor==='shot'?'从当前镜头开头计时，镜头移动时音效一起移动。':'从整期开始处计算，镜头移动时音效位置不变。'}>定位方式<NativeSelect size="sm" disabled={disabled} value={anchor} onChange={e=>change({anchor:e.target.value as AudioDraft['anchor']})}><option value="absolute">固定在时间线</option><option value="shot">跟随镜头移动</option></NativeSelect></label>{anchor==='shot'&&!selectedShotId&&<label>镜头<NativeSelect size="sm" disabled={disabled} value={shot} onChange={e=>change({shot:e.target.value})}>{unique.map(c=><option key={c.shotId}>{c.shotId}</option>)}</NativeSelect></label>}</WorkspaceComposerSetting>
     <WorkspaceComposerSetting compact label="音效位置" summary={`${anchor==='shot'?'偏移':'位置'} ${offset} 秒`} open={audioSetting==='offset'} onOpenChange={open=>setAudioSetting(open?'offset':null)} disabled={disabled}><label>{anchor==='shot'?'距镜头开头（秒）':'时间线位置（秒）'}<input disabled={disabled} type="number" min="0" step="0.1" value={offset} onChange={e=>change({offset:Number(e.target.value)})}/></label></WorkspaceComposerSetting>
     <WorkspaceComposerSetting compact label="音效时长" summary={`${duration} 秒`} open={audioSetting==='duration'} onOpenChange={open=>setAudioSetting(open?'duration':null)} disabled={disabled}><label>时长（秒）<input disabled={disabled} type="number" min="0.1" step="0.1" value={duration} onChange={e=>change({duration:Number(e.target.value)})}/></label></WorkspaceComposerSetting>
    </>}

    {kind==='sfx'&&inputMode==='search'&&<Button size="sm" color="tertiary" iconLeading={Save} aria-label="保存音效意图" title="保存本镜音效意图" isDisabled={disabled||!prompt.trim()||prompt.trim()===(intentShot?.soundIntent??'')} onPress={()=>void run('saveWorkspaceSoundIntent',{expectedProjectSha256:w.project.sha256,shotId:shot,soundIntent:prompt.trim()})}/>}
    {kind==='bgm'&&<Button size="sm" color="secondary" aria-label="保存本期配乐配置" title="保存到本生产单，所有镜头共用" isDisabled={disabled||!description.trim()} onPress={()=>void run('saveWorkspaceMusicSettings',{settings:{description,query:prompt,materialRevisionId:manual}}).then(saved=>{if(saved)setMusicSettingsSaved(true);})}>保存配置</Button>}
    <Button className="workspace-audio-composer-primary" size="sm" color="primary" aria-label={inputMode==='upload'?(kind==='sfx'?'准备导入音效':'准备人工音频'):kind==='sfx'?'根据意图找音效':'检索并获取'} isDisabled={disabled||!description.trim()||(inputMode==='upload'?!manual:!service?.executable||!(kind==='sfx'?soundQuery:prompt.trim())||!!w.audio?.preparations.some(p=>p.kind===kind&&(kind!=='sfx'||p.shotId===shot)&&['ready','running'].includes(p.status)))||kind==='sfx'&&anchor==='shot'&&!shot} onPress={()=>void run('prepareWorkspaceAudio',{kind,description:kind==='sfx'&&inputMode==='search'?prompt.trim().slice(0,100)||description:description,query:kind==='sfx'?soundQuery:prompt,...(inputMode==='upload'?{materialRevisionId:manual}:{selection,...(kind==='sfx'?{intent:prompt.trim(),candidateCount:3}:{})}),durationSeconds:kind==='sfx'?duration:episodeDuration,anchor:kind==='sfx'?anchor:'absolute',offsetSeconds:kind==='sfx'?offset:0,...(kind==='sfx'&&anchor==='shot'?{shotId:shot}:{})})}>{inputMode==='upload'?'加入候选':kind==='sfx'?'找音效':'检索并获取'}</Button>
    {inputMode==='search'&&!service?.executable&&<small>请在下方来源中选择可用的 Freesound 连接。</small>}
    {inputMode==='search'&&kind==='sfx'&&prompt.trim()&&!soundQuery&&<small>暂未识别声音类型，请改用英文检索词。</small>}
    {kind==='bgm'&&musicSettingsSaved&&<small role="status">已保存到本生产单。</small>}
   </div>
  </div>
  {bridge&&kind==='sfx' &&<p className="workspace-audio-note">导入音效准备后，先保存并返回素材准备，再加入镜头。</p>}
  {!!effects.length&&<section className="workspace-audio-group" aria-label="本镜头音效"><div className="workspace-audio-group-heading"><h4>{selectedShotId?`${selectedShotId} · 本镜头音效`:'音效'}</h4><span>{effects.length} 条</span></div>{effects.map(candidate)}</section>}
  {!!absoluteEffects.length&&<section className="workspace-audio-group" aria-label="整期定位音效"><h4>整期定位音效</h4>{absoluteEffects.map(candidate)}</section>}
  {!!other.length&&<section className="workspace-audio-group" aria-label="配乐与原声"><h4>配乐与原声</h4>{other.map(candidate)}</section>}
  </div>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
export function WorkspaceAudioPanel({workspace:w,command,onChange,project,bridge,readOnly=false,effectsOnly=false}:Props&{effectsOnly?:boolean}){
 const [live,setLive]=useState<OpenChatCutProject|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!bridge?.connected)return;let active=true;void bridge.inspect().then(v=>{if(active)setLive(v.document);}).catch(()=>{});return()=>{active=false;};},[bridge?.connected,w.project.sha256]);
 const doc=bridge?live:project,shots=Object.fromEntries([...new Set(w.clips.map(c=>c.shotId))].map(id=>[id,w.clips.filter(c=>c.shotId===id).map(c=>c.itemId)])),mix=doc?readWorkspaceAudioMix(doc,shots):w.audio?.mix;
 async function apply(edit:WorkspaceAudioEdit){setBusy(true);setError('');try{if(bridge){const result=await bridge.applyNativeEdit('apply-audio-mix',{edit});setLive(result);}else onChange(await command('mixWorkspaceAudio',{episodeId:w.episodeId,workspaceId:w.id,expectedRevision:w.revision,edit}) as ProductionWorkspace);}catch(e){setError(e instanceof Error?e.message:'混音保存失败。');}finally{setBusy(false);}}
 if(effectsOnly){
  const effects=mix?.sounds.filter(sound=>sound.kind==='sfx')??[];
  const disabled=readOnly||busy||w.stale||!!bridge&&!bridge.connected;
  return <section className="workspace-audio" aria-label="音效调整">
   <h3>已用音效</h3>
   {effects.map(sound=>{
    const label=w.audio?.preparations.find(preparation=>preparation.adoptedItemId===sound.itemId)?.description;
    return <SoundRow key={JSON.stringify(sound)} sound={sound} label={label} workspaceId={w.id} disabled={disabled} apply={apply}/>;
   })}
   {!effects.length&&<p className="workspace-saved-empty">时间线上暂无已用音效。</p>}
   {error&&<p role="alert">{error}</p>}
  </section>;
 }
 if(readOnly)return <section className="workspace-audio workspace-audio-readonly" aria-label="当前混音"><h3>当前混音</h3>
  {mix?.voices.length?<table className="workspace-saved-mix" aria-label="已保存主声混音"><thead><tr><th>镜头</th><th>主声</th><th>音量</th></tr></thead><tbody>{mix.voices.map(voice=><tr key={voice.shotId}><th scope="row">{voice.shotId}</th><td>{voice.mode==='none'?'无主声':voice.mode==='tts'?'口播':'原片声音'}{voice.mode!=='none'&&voice.sourceLabel&&<small>{voice.sourceLabel}</small>}{voice.mode!=='none'&&voice.durationSeconds!=null&&<small>{(voice.startSeconds??0).toFixed(2)}–{((voice.startSeconds??0)+voice.durationSeconds).toFixed(2)}s{voice.mode==='source'&&voice.sourceStartSeconds!=null?` · 源 ${voice.sourceStartSeconds.toFixed(2)}s`:''}</small>}{voice.mode==='source'&&voice.coverage==='partial'&&<small>原声仅覆盖部分镜头</small>}{voice.ambienceGainDb!==null&&<small>环境声 {voice.ambienceGainDb} dB</small>}</td><td>{voice.mode==='none'?'—':`${voice.gainDb} dB`}</td></tr>)}</tbody></table>:<p className="workspace-saved-empty">没有可读取的主声混音记录。</p>}
  {mix?.sounds.length?<details className="workspace-saved-timing"><summary>配乐与音效 · {mix.sounds.length} 条</summary><table aria-label="已保存配乐与音效"><thead><tr><th>类型</th><th>位置／时长</th><th>音量／遇人声降低</th></tr></thead><tbody>{mix.sounds.map(sound=><tr key={sound.itemId}><td>{sound.kind==='bgm'?'整期配乐':'音效'}</td><td>{sound.startSeconds.toFixed(1)}s / {sound.durationSeconds.toFixed(1)}s</td><td>{sound.gainDb} dB / {sound.duckDepthDb} dB</td></tr>)}</tbody></table></details>:<p className="workspace-saved-empty">未添加配乐或音效</p>}
  </section>;
 return <section className="workspace-audio" aria-label="当前混音"><h3>当前混音</h3>{mix?.voices.map(v=><VoiceRow key={v.shotId+JSON.stringify(v)} voice={v} workspace={w} ids={shots[v.shotId]} disabled={busy||w.stale||!!bridge&&!bridge.connected} apply={apply}/>)}{mix?.sounds.map(s=><SoundRow key={s.itemId+JSON.stringify(s)} sound={s} workspaceId={w.id} disabled={busy||w.stale||!!bridge&&!bridge.connected} apply={apply}/>)}{error&&<p role="alert">{error}</p>}</section>;
}
function VoiceRow({voice:v,workspace:w,ids,disabled,apply}:{voice:NonNullable<ProductionWorkspace['audio']>['mix']['voices'][number];workspace:ProductionWorkspace;ids:string[];disabled:boolean;apply:(edit:WorkspaceAudioEdit)=>Promise<void>}){
 const [mode,setMode]=useState(v.mode),[gainDb,setGain]=useState(v.gainDb),[ambience,setAmbience]=useState(v.ambienceGainDb!==null),[environmentGain,setEnvironmentGain]=useState(v.ambienceGainDb??-24),[source,setSource]=useState(v.sourceItemId??'');
 const prepared=w.audio?.preparations.filter(p=>p.kind==='source'&&p.shotId===v.shotId&&p.adoptedItemId&&p.audioTrackId)??[],selection=prepared.find(p=>p.sourceItemId===source)??prepared[0],narration=w.narration?.find(n=>n.shotId===v.shotId);
 return <div className="workspace-audio-voice"><strong>{v.shotId}</strong>{v.durationSeconds!==undefined&&v.durationSeconds!==null&&<span>{v.sourceLabel??'口播'} · {v.startSeconds?.toFixed(2)}–{((v.startSeconds??0)+v.durationSeconds).toFixed(2)}s{v.mode==='source'?` · 源 ${v.sourceStartSeconds?.toFixed(2)}s`:''}</span>}<label>主声音<NativeSelect size="sm" disabled={disabled} value={mode} onChange={e=>setMode(e.target.value as WorkspaceVoiceMode)}><option value="none">无主声</option><option value="source">原片声音</option><option value="tts">口播</option></NativeSelect></label><label>音量 dB<input disabled={disabled||mode==='none'} type="number" min="-60" max="12" value={gainDb} onChange={e=>setGain(Number(e.target.value))}/></label>{mode==='tts'&&<label className="workspace-audio-checkbox"><input type="checkbox" disabled={disabled} checked={ambience} onChange={e=>setAmbience(e.target.checked)}/>保留低音量原声</label>}{(mode==='source'||mode==='tts'&&ambience)&&<label>原片音轨<NativeSelect size="sm" disabled={disabled} value={selection?.sourceItemId??''} onChange={e=>setSource(e.target.value)}><option value="">请先在素材准备提取并采用</option>{prepared.map(p=><option key={p.id} value={p.sourceItemId??''}>{p.description} · {p.id.slice(0,6)}</option>)}</NativeSelect></label>}{mode==='tts'&&ambience&&<label>环境声 dB<input type="number" min="-60" max="-12" value={environmentGain} onChange={e=>setEnvironmentGain(Number(e.target.value))}/></label>}<Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void apply({kind:'voice',workspaceId:w.id,shotId:v.shotId,visualItemIds:ids,mode,gainDb,ambienceGainDb:mode==='tts'&&ambience?environmentGain:null,...(selection?{sourceItemId:selection.sourceItemId!,sourceAssetId:`audio-track-${selection.audioTrackId}`} :{}),...(narration?.audioTrackId?{narrationAssetId:`audio-track-${narration.audioTrackId}`}:{})})}>应用</Button>{v.mode==='source'&&v.coverage==='partial'&&<p role="status">原声仅覆盖部分镜头；整段声学对齐不可用。</p>}</div>;
}
function SoundRow({sound:s,workspaceId,disabled,apply,summary=true,label}:{sound:NonNullable<ProductionWorkspace['audio']>['mix']['sounds'][number];workspaceId:string;disabled:boolean;apply:(edit:WorkspaceAudioEdit)=>Promise<void>;summary?:boolean;label?:string}){const [gainDb,setGain]=useState(s.gainDb),[depth,setDepth]=useState(s.duckDepthDb);return <div className="workspace-audio-voice">{summary&&<><strong>{label??(s.kind==='bgm'?'整期配乐':'音效')}</strong><span>{s.startSeconds.toFixed(1)}s · {s.durationSeconds.toFixed(1)}s</span></>}<label>音量 dB<input disabled={disabled} type="number" min="-60" max="12" value={gainDb} onChange={e=>setGain(Number(e.target.value))}/></label><label title="有人声时降低配乐或音效音量；0 表示不降低。">遇人声降低（dB）<input disabled={disabled} type="number" min="0" max="30" value={depth} onChange={e=>setDepth(Number(e.target.value))}/></label><small>有人声时降低配乐或音效音量；0 表示不降低。</small><Button size="sm" color="secondary" isDisabled={disabled} onPress={()=>void apply({kind:'sound',workspaceId,itemId:s.itemId,gainDb,duckDepthDb:depth})}>应用</Button><Button size="sm" color="tertiary" isDisabled={disabled} onPress={()=>void apply({kind:'sound',workspaceId,itemId:s.itemId,gainDb,duckDepthDb:depth,remove:true})}>移除</Button></div>;}
