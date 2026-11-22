import {uiText} from '../i18n/ui';
import {useEffect,useId,useRef,useState} from 'react';
import {Check,Monitor,Moon,RotateCcw,Sun,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Toggle} from '../ui/dan-ui/components/base/toggle/toggle';
import {useDialogFocus} from '../ui/useDialogFocus';
import {defaultOwnerPreferences,type OwnerPreferences} from '../preferences/preferences';
import './owner-preferences.css';
export type PreferencesPage='personal'|'notifications';
export function OwnerPreferencesDialog({preferences,loading,saving,unavailable,error,onReload,onSave,onClose,embedded=false,onStateChange}:{
 embedded?:boolean;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void;csrf?:string;preferences:OwnerPreferences;page:PreferencesPage;loading:boolean;saving:boolean;unavailable:boolean;error:string;
 onReload:()=>void;onSave:(value:OwnerPreferences)=>Promise<boolean>;onClose:()=>void;
}){
 const fieldId=useId(),saveRequest=useRef(0),saveLock=useRef(false);
 const [draft,setDraft]=useState(preferences),[baseline,setBaseline]=useState(preferences),[saved,setSaved]=useState(false),[pending,setPending]=useState(false),[failed,setFailed]=useState(false);
 const ref=useDialogFocus<HTMLDivElement>(!embedded,()=>{if(!saving&&!pending)onClose();});
 useEffect(()=>()=>{saveRequest.current++;saveLock.current=false;},[]);
 const stateChanged=useRef(onStateChange);stateChanged.current=onStateChange;
 const title=uiText("界面与通知"),busy=saving||pending,disabled=busy||unavailable;
 const selection=(value:OwnerPreferences)=>[value.language,value.appearance,value.compactRows,value.notifications.review,value.notifications.failure,value.notifications.delivery,value.notifications.inApp!==false,value.notifications.macOS!==false];
 const dirty=JSON.stringify(selection(draft))!==JSON.stringify(selection(baseline));
 useEffect(()=>{stateChanged.current?.({busy,dirty});},[busy,dirty]);
 useEffect(()=>()=>stateChanged.current?.({busy:false,dirty:false}),[]);
 useEffect(()=>{if(!dirty&&!busy){setDraft(preferences);setBaseline(preferences);}},[preferences,loading]);
 const update=(patch:Partial<OwnerPreferences>)=>{setDraft(current=>({...current,...patch}));setSaved(false);setFailed(false);};
 function restore(){update({language:'zh-CN',appearance:'light',compactRows:true,notifications:{...defaultOwnerPreferences.notifications}});}
 async function save(){
  const next={...preferences,language:draft.language,appearance:draft.appearance,compactRows:draft.compactRows,notifications:draft.notifications};
  if(disabled||!dirty||saveLock.current)return;
  const request=++saveRequest.current;saveLock.current=true;setPending(true);setFailed(false);
  try{
   const accepted=await onSave(next);
   if(request!==saveRequest.current)return;
   if(accepted){setDraft(next);setBaseline(next);setSaved(true);}else setFailed(true);
  }catch{if(request===saveRequest.current)setFailed(true);}
  finally{if(request===saveRequest.current){saveLock.current=false;setPending(false);}}
 }
 const appearanceOptions=[['light','浅色',Sun],['dark','深色',Moon],['system','跟随系统',Monitor]] as const;
 const appearanceField=embedded?<div className="owner-appearance-field"><span id={fieldId+'-appearance-label'}>{uiText('外观')}</span><div className="owner-appearance-segmented" role="radiogroup" aria-labelledby={fieldId+'-appearance-label'}>{appearanceOptions.map(([value,label,Icon])=><label key={value}><input type="radio" name={fieldId+'-appearance'} value={value} checked={draft.appearance===value} disabled={disabled} onChange={()=>update({appearance:value})}/><span><Icon size={13} aria-hidden="true"/>{uiText(label)}</span></label>)}</div></div>:<div className="owner-appearance-field"><label htmlFor={fieldId+'-appearance'}>{uiText("外观")}</label><NativeSelect icon={{light:Sun,dark:Moon,system:Monitor}[draft.appearance]} optionIcons={{light:Sun,dark:Moon,system:Monitor}} id={fieldId+'-appearance'} size="sm" disabled={disabled} aria-label={uiText("外观")} value={draft.appearance} onChange={event=>update({appearance:event.target.value as OwnerPreferences['appearance']})}><option value="light">{uiText("浅色")}</option><option value="dark">{uiText("深色")}</option><option value="system">{uiText("跟随系统")}</option></NativeSelect></div>;
 const languageField=<div className="owner-language-field owner-appearance-field"><label htmlFor={fieldId+'-language'}>{uiText("界面语言")}</label><NativeSelect icon={null} id={fieldId+'-language'} size="sm" disabled={disabled} aria-label={uiText("界面语言")} value={draft.language} onChange={event=>update({language:event.target.value as OwnerPreferences['language']})}><option value="zh-CN">{uiText("简体中文")}</option><option value="en-US">English</option></NativeSelect></div>;
 const densityField=<div className="owner-preference-toggle"><span>{uiText("使用紧凑行距")}</span><Toggle isDisabled={disabled} aria-label={uiText("使用紧凑行距")} isSelected={draft.compactRows} onChange={compactRows=>update({compactRows})}/></div>;
 const channels=<div className="owner-notification-toggles">{([['inApp',uiText("应用内提醒")],['macOS',uiText("macOS 桌面提醒")]] as const).map(([key,label])=><div className="owner-preference-toggle" key={key}><span>{label}</span><Toggle isDisabled={disabled} aria-label={label} isSelected={draft.notifications[key]!==false} onChange={enabled=>update({notifications:{...draft.notifications,[key]:enabled}})}/></div>)}</div>;
 const events=<div className="owner-notification-toggles">{([['review',uiText("需要人工确认时通知")],['failure',uiText("生产或连接失败时通知")],['delivery',uiText("交付包完成时通知")]] as const).map(([key,label])=><div className="owner-preference-toggle" key={key}><span>{label}</span><Toggle isDisabled={disabled} aria-label={label} isSelected={draft.notifications[key]} onChange={enabled=>update({notifications:{...draft.notifications,[key]:enabled}})}/></div>)}</div>;
 const content=<div className={`owner-preferences-dialog owner-preferences-storage${embedded?' owner-settings-pane owner-preferences-embedded':''}`} role={embedded?undefined:'dialog'} aria-modal={embedded?undefined:true} aria-label={embedded?undefined:title} ref={ref}>
  <header><h2>{title}</h2><Button size="sm" color="tertiary" iconLeading={X} aria-label={uiText('关闭{title}',{title})} isDisabled={busy} onClick={onClose}/></header>
  {loading?<div className="owner-preferences-loading" role="status">{uiText("正在读取偏好…")}</div>:<form onSubmit={event=>{event.preventDefault();void save();}}>
   <section className="owner-preferences-card">
    <section className="owner-preferences-section"><h3>{uiText("界面")}</h3><div className="owner-preferences-section-content">{appearanceField}{languageField}{densityField}</div></section>
    <section className="owner-preferences-section"><h3>{uiText("接收方式")}</h3><div className="owner-preferences-section-content">{channels}<details className="owner-notification-events"><summary>{uiText("自定义提醒")}</summary>{events}<p className="owner-preferences-note">{uiText("关闭提醒后，待处理事项和任务仍可查看。")}</p></details></div></section>
    {error&&<div className="owner-preferences-error"><p className="form-error" role="alert">{uiText(error)}</p><Button size="xs" color="tertiary" type="button" onClick={onReload}>{uiText("重新读取")}</Button></div>}
   </section><footer><span role="status" data-state={failed?'failed':saved&&!dirty?'saved':'draft'}>{busy?uiText("保存中…"):failed?uiText("保存失败，修改尚未保存"):dirty?uiText("有未保存修改"):saved?uiText("已保存"):uiText("未修改")}</span><div><Button size="sm" color="secondary" iconLeading={RotateCcw} type="button" isDisabled={disabled} onClick={restore} aria-describedby={fieldId+'-restore-scope'}>{uiText("恢复默认")}</Button><Button size="sm" color="primary" iconLeading={Check} type="submit" isDisabled={disabled||!dirty}>{busy?uiText("保存中…"):uiText("保存偏好")}</Button></div><small id={fieldId+'-restore-scope'} className="owner-restore-scope">{uiText("恢复界面设置和所有通知开关。")}</small></footer>
  </form>}
 </div>;
 return embedded?content:<div className="modal-backdrop owner-preferences-backdrop">{content}</div>;
}
