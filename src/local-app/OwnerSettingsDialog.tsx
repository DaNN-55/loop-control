import {uiText} from '../i18n/ui';
import {Activity,FolderOpen,KeyRound,Plug,RefreshCw,ScrollText,ShieldCheck,SlidersHorizontal,UserRound,Wrench} from 'lucide-react';
import {createContext,useContext,useLayoutEffect,type ReactNode,type RefObject} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useDialogFocus} from '../ui/useDialogFocus';
import './owner-settings.css';

export const ownerSettingsPages=[
 {id:'connections',label:'制作服务',icon:Plug},
 {id:'storage',label:'文件存储',icon:FolderOpen},
 {id:'personal',label:'界面与通知',icon:SlidersHorizontal},
 {id:'security',label:'登录与安全',icon:ShieldCheck},
 {id:'system',label:'维护工具',icon:Wrench},
] as const;
const maintenancePages=[
 {id:'system',label:'系统状态',icon:Activity},
 {id:'logs',label:'日志',icon:ScrollText},
 {id:'secrets',label:'高级密钥',icon:KeyRound},
] as const;
export type OwnerSettingsPage=typeof ownerSettingsPages[number]['id']|'notifications'|'logs'|'secrets'|'cleanup';
export interface OwnerSettingsPaneState{busy:boolean;dirty:boolean}
const MaintenanceNavigation=createContext<ReactNode>(null);
export function OwnerSettingsMaintenance(){return useContext(MaintenanceNavigation);}

export function SettingsRefreshButton({refreshing,disabled,onRefresh}:{
 refreshing:boolean;disabled?:boolean;onRefresh:()=>void;
}){
 return <Button size="sm" color="secondary" type="button" iconLeading={RefreshCw} isDisabled={refreshing||disabled} onPress={onRefresh}>{uiText(refreshing?'读取中…':'刷新')}</Button>;
}

export function OwnerSettingsDialog({page,onNavigate,onClose,returnFocusRef,canManageSecrets,busy,email,children}:{page:OwnerSettingsPage;onNavigate:(page:OwnerSettingsPage)=>void;onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>;canManageSecrets:boolean;busy:boolean;displayName?:string;email:string;children:ReactNode}){
 const activePage=page==='notifications'?'personal':page==='logs'||page==='secrets'?'system':page;
 const label=maintenancePages.find(item=>item.id===page)?.label??ownerSettingsPages.find(item=>item.id===activePage)?.label??'回收站';
 const dialog=useDialogFocus<HTMLElement>(true,onClose,returnFocusRef);
 useLayoutEffect(()=>{const element=dialog.current;if(!element||element.contains(document.activeElement))return;const title=element.querySelector<HTMLElement>('.owner-settings-main header h2');if(title){title.tabIndex=-1;title.focus();}},[page,dialog]);
 return <div className="modal-backdrop owner-settings-backdrop" role="presentation"><section ref={dialog} role="dialog" aria-modal="true" aria-label={uiText(label)} aria-labelledby={page==='connections'?'connections-settings-title':undefined} className={`owner-settings-dialog owner-settings-page-${page}`}>
  <nav className="owner-settings-nav" aria-label={uiText("设置页面")}><h2>{uiText("设置")}</h2><div className="owner-settings-pages">{ownerSettingsPages.map(({id,label,icon:Icon})=><button type="button" key={id} aria-current={activePage===id?'page':undefined} disabled={busy} onClick={()=>{if(page!==id)onNavigate(id);}}><Icon size={17} aria-hidden="true"/><span>{uiText(label)}</span></button>)}</div><div className="owner-settings-identity"><UserRound size={18} aria-hidden="true"/><div><strong title={email}>{email}</strong></div></div></nav>
  <div className="owner-settings-main"><MaintenanceNavigation.Provider value={activePage==='system'?<nav className="owner-settings-maintenance" aria-label={uiText('维护工具页面')}>{maintenancePages.filter(item=>item.id!=='secrets'||canManageSecrets).map(({id,label})=><button type="button" key={id} aria-current={page===id?'page':undefined} disabled={busy} onClick={()=>{if(page!==id)onNavigate(id);}}>{uiText(label)}</button>)}</nav>:null}>{children}</MaintenanceNavigation.Provider></div>
 </section></div>;
}
