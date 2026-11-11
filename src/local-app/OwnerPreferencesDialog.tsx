import {ImagePreview} from '../ui/media/ImagePreview';
import {useEffect,useId,useRef,useState,type ChangeEvent} from 'react';
import {Check,RotateCcw,Upload,UserRound,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Toggle} from '../ui/dan-ui/components/base/toggle/toggle';
import {useDialogFocus} from '../ui/useDialogFocus';
import {defaultOwnerPreferences,type OwnerPreferences} from '../preferences/preferences';
import {prepareOwnerAvatar} from './avatarUpload';
import './owner-preferences.css';
import {MediaRootSettingsDialog} from './MediaRootSettingsDialog';
import {LogStorageSettings} from './LogStorageSettings';
export type PreferencesPage='personal'|'notifications';
export function OwnerPreferencesDialog({preferences,page,loading,saving,unavailable,error,onReload,onSave,onClose,csrf,embedded=false,onStateChange}:{
 embedded?:boolean;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void;csrf?:string;preferences:OwnerPreferences;page:PreferencesPage;loading:boolean;saving:boolean;unavailable:boolean;error:string;
 onReload:()=>void;onSave:(value:OwnerPreferences)=>Promise<boolean>;onClose:()=>void;
}){
 const fieldId=useId(),fileInput=useRef<HTMLInputElement>(null),avatarRequest=useRef(0),saveRequest=useRef(0),saveLock=useRef(false);
 const [draft,setDraft]=useState(preferences),[baseline,setBaseline]=useState(preferences),[saved,setSaved]=useState(false),[pending,setPending]=useState(false),[failed,setFailed]=useState(false),[avatarError,setAvatarError]=useState(''),[uploading,setUploading]=useState(false);
 const ref=useDialogFocus<HTMLDivElement>(!embedded,()=>{if(!saving&&!pending)onClose();});
 useEffect(()=>()=>{avatarRequest.current++;saveRequest.current++;saveLock.current=false;},[]);
 const [tab,setTab]=useState<'profile'|'storage'>('profile'),[mediaState,setMediaState]=useState({busy:false,dirty:false}),[logState,setLogState]=useState({busy:false,dirty:false});
 const stateChanged=useRef(onStateChange);stateChanged.current=onStateChange;
 const personal=page==='personal',title=personal?'个人偏好':'通知',storageBusy=mediaState.busy||logState.busy,busy=saving||pending,disabled=busy||unavailable||uploading||embedded&&storageBusy;
 const selection=(value:OwnerPreferences)=>personal?[value.displayName,value.avatar,value.language,value.appearance,value.compactRows]:[value.notifications.review,value.notifications.failure,value.notifications.delivery,value.notifications.inApp!==false,value.notifications.macOS!==false];
 const dirty=JSON.stringify(selection(draft))!==JSON.stringify(selection(baseline));
 useEffect(()=>{stateChanged.current?.({busy:busy||uploading||storageBusy,dirty:dirty||mediaState.dirty||logState.dirty});},[busy,uploading,storageBusy,dirty,mediaState.dirty,logState.dirty]);
 useEffect(()=>()=>stateChanged.current?.({busy:false,dirty:false}),[]);
 useEffect(()=>{if(!dirty&&!busy){setDraft(preferences);setBaseline(preferences);}},[preferences,loading]);
 const update=(patch:Partial<OwnerPreferences>)=>{setDraft(current=>({...current,...patch}));setSaved(false);setFailed(false);};
 function restore(){setAvatarError('');update(personal?{displayName:'',avatar:null,language:'zh-CN',appearance:'light',compactRows:true}:{notifications:{...defaultOwnerPreferences.notifications}});}
 async function upload(event:ChangeEvent<HTMLInputElement>){
  const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file)return;
  const request=++avatarRequest.current;setAvatarError('');setUploading(true);
  try{const avatar=await prepareOwnerAvatar(file);if(request===avatarRequest.current)update({avatar});}
  catch(error){if(request===avatarRequest.current)setAvatarError(error instanceof Error?error.message:'图片处理失败，请重试。');}
  finally{if(request===avatarRequest.current)setUploading(false);}
 }
 async function save(){
  const next=personal?{...preferences,displayName:draft.displayName,avatar:draft.avatar,language:draft.language,appearance:draft.appearance,compactRows:draft.compactRows}:{...preferences,notifications:draft.notifications};
  if(disabled||!dirty||saveLock.current)return;
  const request=++saveRequest.current;saveLock.current=true;setPending(true);setFailed(false);
  try{
   const accepted=await onSave(next);
   if(request!==saveRequest.current)return;
   if(accepted){const normalized={...next,displayName:next.displayName.trim()};setDraft(normalized);setBaseline(normalized);setSaved(true);}else setFailed(true);
  }catch{if(request===saveRequest.current)setFailed(true);}
  finally{if(request===saveRequest.current){saveLock.current=false;setPending(false);}}
 }
 const avatarField=<div className="owner-avatar-field"><div className="owner-avatar-preview">{draft.avatar?<ImagePreview src={draft.avatar} alt="头像预览"/>:<UserRound size={28} aria-hidden="true"/>}</div><div className="owner-avatar-actions"><div><Button size="sm" color="secondary" iconLeading={Upload} type="button" isDisabled={disabled} onClick={()=>fileInput.current?.click()}>{uploading?'处理中…':'上传头像'}</Button>{draft.avatar&&<Button size="sm" color="tertiary" type="button" isDisabled={disabled} onClick={()=>{setAvatarError('');update({avatar:null});}}>移除</Button>}</div><span>PNG、JPEG、WebP，最大 5 MB</span></div><input ref={fileInput} type="file" aria-label="上传头像图片" accept="image/png,image/jpeg,image/webp" hidden disabled={disabled} onChange={event=>void upload(event)}/></div>;
 const displayNameField=<label className="owner-display-name">显示名称<InputBase size="sm" aria-label="显示名称" disabled={disabled} maxLength={60} value={draft.displayName} placeholder="未填写时使用登录邮箱" onChange={event=>update({displayName:event.target.value})}/></label>;
 const appearanceField=<div className="owner-appearance-field"><label htmlFor={fieldId+'-appearance'}>外观</label><NativeSelect id={fieldId+'-appearance'} size="sm" disabled={disabled} aria-label="外观" value={draft.appearance} onChange={event=>update({appearance:event.target.value as OwnerPreferences['appearance']})}><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></NativeSelect></div>;
 const densityField=<div className="owner-preference-toggle"><span>使用紧凑行距</span><Toggle isDisabled={disabled} aria-label="使用紧凑行距" isSelected={draft.compactRows} onChange={compactRows=>update({compactRows})}/></div>;
 const channels=<div className="owner-notification-toggles">{([['inApp','应用内提醒'],['macOS','macOS 桌面提醒']] as const).map(([key,label])=><div className="owner-preference-toggle" key={key}><span>{label}</span><Toggle isDisabled={disabled} aria-label={label} isSelected={draft.notifications[key]!==false} onChange={enabled=>update({notifications:{...draft.notifications,[key]:enabled}})}/></div>)}</div>;
 const events=<div className="owner-notification-toggles">{([['review','需要人工确认时通知'],['failure','生产或连接失败时通知'],['delivery','交付包完成时通知']] as const).map(([key,label])=><div className="owner-preference-toggle" key={key}><span>{label}</span><Toggle isDisabled={disabled} aria-label={label} isSelected={draft.notifications[key]} onChange={enabled=>update({notifications:{...draft.notifications,[key]:enabled}})}/></div>)}</div>;
 const storage=csrf?<><MediaRootSettingsDialog csrf={csrf} onClose={onClose} embedded onStateChange={setMediaState}/><LogStorageSettings csrf={csrf} onStateChange={setLogState}/></>:null;
 const profile=embedded?<><section className="owner-preferences-section"><h3>个人资料</h3><div className="owner-preferences-section-content">{avatarField}{avatarError&&<p className="form-error" role="alert">{avatarError}</p>}{displayNameField}</div></section><section className="owner-preferences-section"><h3>界面</h3><div className="owner-preferences-section-content">{appearanceField}<div className="owner-preference-toggle"><span>界面语言</span><span className="owner-preferences-language">简体中文</span></div>{densityField}</div></section></>:<>{avatarField}{avatarError&&<p className="form-error" role="alert">{avatarError}</p>}{displayNameField}<div className="owner-preferences-fields"><div><span>界面语言</span><p>简体中文</p></div>{appearanceField}</div>{densityField}{storage}</>;
 const content=<div className={`owner-preferences-dialog${personal&&csrf?' owner-preferences-storage':''}${embedded?' owner-settings-pane owner-preferences-embedded':''}`} role={embedded?undefined:'dialog'} aria-modal={embedded?undefined:true} aria-label={embedded?undefined:title} ref={ref}>
  <header><h2>{title}</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label={`关闭${title}`} isDisabled={busy||embedded&&storageBusy} onClick={onClose}/></header>
  {embedded&&personal&&csrf&&<div className="owner-preferences-tabs" role="tablist" aria-label="个人偏好分区">{([['profile','个人与界面'],['storage','存储位置']] as const).map(([key,label])=><button key={key} id={fieldId+'-'+key+'-tab'} type="button" role="tab" aria-selected={tab===key} aria-controls={fieldId+'-'+key+'-panel'} tabIndex={tab===key?0:-1} disabled={busy||uploading||storageBusy} onClick={()=>setTab(key)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const next=key==='profile'?'storage':'profile';setTab(next);document.getElementById(fieldId+'-'+next+'-tab')?.focus();}}}>{label}</button>)}</div>}
  {loading?<div className="owner-preferences-loading" role="status">正在读取偏好…</div>:<form onSubmit={event=>{event.preventDefault();void save();}}>
   <section className="owner-preferences-card">
    {personal?embedded?<><div className="owner-preferences-tab-panel" hidden={tab!=='profile'} role={csrf?'tabpanel':undefined} id={fieldId+'-profile-panel'} aria-labelledby={csrf?fieldId+'-profile-tab':undefined}>{profile}</div>{csrf&&<div className="owner-preferences-tab-panel owner-preferences-storage-panel" hidden={tab!=='storage'} role="tabpanel" id={fieldId+'-storage-panel'} aria-labelledby={fieldId+'-storage-tab'}>{storage}</div>}</>:profile:embedded?<><section className="owner-preferences-section"><h3>接收方式</h3><div className="owner-preferences-section-content">{channels}</div></section><section className="owner-preferences-section"><h3>提醒内容</h3><div className="owner-preferences-section-content">{events}<p className="owner-preferences-note">关闭提醒后，待处理事项和任务仍可查看。</p></div></section></>:<>{channels}<p className="owner-preferences-note">关闭提醒后，待处理事项和任务仍可查看。</p><h3>提醒内容</h3>{events}</>}
    {error&&<div className="owner-preferences-error"><p className="form-error" role="alert">{error}</p><Button size="xs" color="tertiary" type="button" onClick={onReload}>重新读取</Button></div>}
   </section><footer hidden={embedded&&personal&&tab==='storage'}><span role="status" data-state={failed?'failed':saved&&!dirty?'saved':'draft'}>{busy?'保存中…':failed?'保存失败，修改尚未保存':dirty?'有未保存修改':saved?'已保存':'未修改'}</span><div><Button size="sm" color="secondary" iconLeading={RotateCcw} type="button" isDisabled={disabled} onClick={restore} aria-describedby={fieldId+'-restore-scope'}>恢复默认</Button><Button size="sm" color="primary" iconLeading={Check} type="submit" isDisabled={disabled||!dirty}>{busy?'保存中…':'保存偏好'}</Button></div><small id={fieldId+'-restore-scope'} className="owner-restore-scope">{personal?"恢复头像、名称、外观和行距。存储位置单独设置。":"恢复本页所有通知开关。"}</small></footer>
  </form>}
 </div>;
 return embedded?content:<div className="modal-backdrop owner-preferences-backdrop">{content}</div>;
}
