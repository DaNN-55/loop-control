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
export type PreferencesPage='personal'|'notifications';
export function OwnerPreferencesDialog({preferences,page,loading,saving,unavailable,error,onReload,onSave,onClose,csrf}:{
 csrf?:string;preferences:OwnerPreferences;page:PreferencesPage;loading:boolean;saving:boolean;unavailable:boolean;error:string;
 onReload:()=>void;onSave:(value:OwnerPreferences)=>Promise<boolean>;onClose:()=>void;
}){
 const fieldId=useId(),fileInput=useRef<HTMLInputElement>(null),avatarRequest=useRef(0);
 const [draft,setDraft]=useState(preferences),[saved,setSaved]=useState(false),[avatarError,setAvatarError]=useState(''),[uploading,setUploading]=useState(false);
 const ref=useDialogFocus<HTMLDivElement>(true,()=>{if(!saving)onClose();});
 useEffect(()=>()=>{avatarRequest.current++;},[]);
 const personal=page==='personal',title=personal?'个人偏好':'通知',disabled=saving||unavailable||uploading;
 const update=(patch:Partial<OwnerPreferences>)=>{setDraft(current=>({...current,...patch}));setSaved(false);};
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
  if(await onSave(next))setSaved(true);
 }
 return <div className="modal-backdrop owner-preferences-backdrop"><div className="owner-preferences-dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
  <header><h2>{title}</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label={`关闭${title}`} isDisabled={saving} onClick={onClose}/></header>
  {loading?<div className="owner-preferences-loading" role="status">正在读取偏好…</div>:<form onSubmit={event=>{event.preventDefault();void save();}}>
   <section className="owner-preferences-card">
    {personal?<>
     <div className="owner-avatar-field"><div className="owner-avatar-preview">{draft.avatar?<img src={draft.avatar} alt="头像预览"/>:<UserRound size={28} aria-hidden="true"/>}</div><div className="owner-avatar-actions"><div><Button size="sm" color="secondary" iconLeading={Upload} type="button" isDisabled={disabled} onClick={()=>fileInput.current?.click()}>{uploading?'处理中…':'上传头像'}</Button>{draft.avatar&&<Button size="sm" color="tertiary" type="button" isDisabled={disabled} onClick={()=>{setAvatarError('');update({avatar:null});}}>移除</Button>}</div><span>PNG、JPEG、WebP，最大 5 MB</span></div><input ref={fileInput} type="file" aria-label="上传头像图片" accept="image/png,image/jpeg,image/webp" hidden disabled={disabled} onChange={event=>void upload(event)}/></div>
     {avatarError&&<p className="form-error" role="alert">{avatarError}</p>}
     <label className="owner-display-name">显示名称<InputBase size="sm" aria-label="显示名称" disabled={disabled} maxLength={60} value={draft.displayName} placeholder="未填写时使用登录邮箱" onChange={event=>update({displayName:event.target.value})}/></label>
     <div className="owner-preferences-fields"><div><label htmlFor={fieldId+'-language'}>界面语言</label><NativeSelect id={fieldId+'-language'} size="sm" disabled={disabled} aria-label="界面语言" value={draft.language} onChange={()=>{}}><option value="zh-CN">简体中文</option></NativeSelect></div><div><label htmlFor={fieldId+'-appearance'}>外观</label><NativeSelect id={fieldId+'-appearance'} size="sm" disabled={disabled} aria-label="外观" value={draft.appearance} onChange={event=>update({appearance:event.target.value as OwnerPreferences['appearance']})}><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></NativeSelect></div></div>
     <div className="owner-preference-toggle"><span>使用紧凑行距</span><Toggle isDisabled={disabled} aria-label="使用紧凑行距" isSelected={draft.compactRows} onChange={compactRows=>update({compactRows})}/></div>
     {csrf&&<MediaRootSettingsDialog csrf={csrf} onClose={onClose} embedded/>}
    </>:<><div className="owner-notification-toggles">{([['review','需要人工确认时通知'],['failure','生产或连接失败时通知'],['delivery','交付包完成时通知']] as const).map(([key,label])=><div className="owner-preference-toggle" key={key}><span>{label}</span><Toggle isDisabled={disabled} aria-label={label} isSelected={draft.notifications[key]} onChange={enabled=>update({notifications:{...draft.notifications,[key]:enabled}})}/></div>)}</div><p className="owner-preferences-note">同时用于应用内通知和 macOS 桌面提醒。</p></>}
    {error&&<div className="owner-preferences-error"><p className="form-error" role="alert">{error}</p><Button size="xs" color="tertiary" type="button" onClick={onReload}>重新读取</Button></div>}
   </section><footer><span role="status">{saved?'已保存':''}</span><div><Button size="sm" color="secondary" iconLeading={RotateCcw} type="button" isDisabled={disabled} onClick={restore}>恢复默认</Button><Button size="sm" color="primary" iconLeading={Check} type="submit" isDisabled={disabled}>{saving?'保存中…':'保存偏好'}</Button></div></footer>
  </form>}
 </div></div>;
}
