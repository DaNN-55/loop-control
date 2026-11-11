import {uiText} from '../i18n/ui';
import {Bell,KeyRound,Plug,ScrollText,ShieldCheck,SlidersHorizontal,Trash2,UserRound} from 'lucide-react';
import {useLayoutEffect,type ReactNode,type RefObject} from 'react';
import {useDialogFocus} from '../ui/useDialogFocus';
import './owner-settings.css';

export const ownerSettingsPages=[
 {id:'personal',label:'个人偏好',icon:SlidersHorizontal},
 {id:'notifications',label:'通知',icon:Bell},
 {id:'security',label:'登录与安全',icon:ShieldCheck},
 {id:'logs',label:'日志',icon:ScrollText},
 {id:'cleanup',label:'回收站',icon:Trash2},
 {id:'connections',label:'连接配置',icon:Plug},
 {id:'secrets',label:'密钥管理',icon:KeyRound},
] as const;
export type OwnerSettingsPage=typeof ownerSettingsPages[number]['id'];
export interface OwnerSettingsPaneState{busy:boolean;dirty:boolean}

export function OwnerSettingsDialog({page,onNavigate,onClose,returnFocusRef,canManageSecrets,busy,displayName,email,children}:{page:OwnerSettingsPage;onNavigate:(page:OwnerSettingsPage)=>void;onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>;canManageSecrets:boolean;busy:boolean;displayName?:string;email:string;children:ReactNode}){
 const dialog=useDialogFocus<HTMLElement>(true,onClose,returnFocusRef),label=ownerSettingsPages.find(item=>item.id===page)!.label;
 useLayoutEffect(()=>{const element=dialog.current;if(!element||element.contains(document.activeElement))return;const title=element.querySelector<HTMLElement>('.owner-settings-main header h2');if(title){title.tabIndex=-1;title.focus();}},[page,dialog]);
 return <div className="modal-backdrop owner-settings-backdrop" role="presentation"><section ref={dialog} role="dialog" aria-modal="true" aria-label={uiText(label)} aria-labelledby={page==='connections'?'connections-settings-title':undefined} className={`owner-settings-dialog owner-settings-page-${page}`}>
  <nav className="owner-settings-nav" aria-label={uiText("设置页面")}><h2>{uiText("所有者设置")}</h2><div className="owner-settings-pages">{ownerSettingsPages.filter(item=>item.id!=='secrets'||canManageSecrets).map(({id,label,icon:Icon})=><button type="button" key={id} aria-current={page===id?'page':undefined} disabled={busy} onClick={()=>{if(page!==id)onNavigate(id);}}><Icon size={17} aria-hidden="true"/><span>{uiText(label)}</span></button>)}</div><div className="owner-settings-identity"><UserRound size={18} aria-hidden="true"/><div><strong title={displayName||email}>{displayName||email}</strong>{displayName&&<span title={email}>{email}</span>}</div></div></nav>
  <div className="owner-settings-main">{children}</div>
 </section></div>;
}
