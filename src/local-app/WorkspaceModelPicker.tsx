import {WorkspacePopover as Popover} from './WorkspacePopover';
import {uiText} from '../i18n/ui';
import {useState} from 'react';
import {Dialog,DialogTrigger,Menu,MenuItem} from 'react-aria-components';
import {Check,ChevronDown,Mic,RefreshCw,Settings2,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {providerDisplayNames} from '../connections/serviceCatalog';
import {WorkspaceModelLogo} from './WorkspaceModelLogo';
import './workspace-generation-composer.css';

export interface WorkspaceModelOption {id:string;label:string;provider?:string;connection?:string;disabled?:boolean;manual?:boolean}
export function WorkspaceModelPicker({label,title,closeLabel='关闭模型选择',options,value,disabled,onChange,onConfigure,onRefresh,refreshing=false,empty,clear,clearLabel='清除模型选择',showConnections=false,compact=true}:{label:string;title:string;closeLabel?:string;options:WorkspaceModelOption[];value:string;disabled?:boolean;onChange:(id:string)=>void;onConfigure?:()=>void;onRefresh?:()=>void;refreshing?:boolean;empty?:string;clear?:boolean;clearLabel?:string;showConnections?:boolean;compact?:boolean}){
 const [open,setOpen]=useState(false);
 const selected=options.find(option=>option.id===value),duplicates=new Set(options.filter((option,index)=>options.some((other,i)=>i!==index&&other.label===option.label)).map(option=>option.label));

 return <DialogTrigger isOpen={open} onOpenChange={setOpen}>
  <Button size={compact?'xs':'sm'} color="tertiary" className="workspace-composer-chip workspace-model-picker-trigger" aria-label={uiText(label)} title={selected?.connection?`${selected.label} · ${selected.connection}`:undefined} isDisabled={disabled} iconTrailing={ChevronDown}>
   {selected&&(selected.manual?<Mic size={16} aria-hidden="true"/>:<WorkspaceModelLogo model={selected.label} provider={selected.provider}/>)}{selected?.label??title}
  </Button>
  <Popover className="dan-ui product-ui workspace-composer-popover workspace-composer-model-popover workspace-model-menu" placement="top start" offset={8} containerPadding={12} shouldFlip>
   <Dialog aria-label={uiText(title)} className="workspace-composer-settings">
    <header><h3>{uiText(title)}</h3><div className="workspace-model-menu-header-actions"><Button size="sm" color="tertiary" aria-label={uiText("刷新模型连接")} iconLeading={RefreshCw} isLoading={refreshing} isDisabled={disabled||!onRefresh} onPress={()=>{if(!refreshing)onRefresh?.();}}/><Button size="sm" color="tertiary" aria-label={uiText(closeLabel)} iconLeading={X} onPress={()=>setOpen(false)}/></div></header>

    <Menu aria-label={label.replace('连接与模型','可用模型')} className="workspace-composer-model-list" selectionMode="single" selectedKeys={value?[value]:[]} disabledKeys={options.filter(option=>option.disabled).map(option=>option.id)} onAction={key=>{setOpen(false);onChange(String(key));}} renderEmptyState={()=><p role="status">{empty??uiText("暂无可用模型。")}</p>}>
     {options.map(option=><MenuItem key={option.id} id={option.id} textValue={`${option.label}${showConnections||duplicates.has(option.label)||option.disabled?` ${option.connection??''}`:''}`} className="workspace-composer-model-option">
      {option.manual?<Mic size={16} aria-hidden="true"/>:<WorkspaceModelLogo model={option.label} provider={option.provider}/>}<span className="workspace-model-menu-label"><span className="workspace-model-menu-name">{option.provider&&providerDisplayNames[option.provider]&&providerDisplayNames[option.provider]!==option.label&&<span aria-hidden="true" className="workspace-model-menu-provider">{providerDisplayNames[option.provider]}</span>}<strong title={option.connection}>{option.label}</strong></span>{(showConnections||duplicates.has(option.label)||option.disabled)&&<small>{option.connection}</small>}</span>{option.id===value&&<Check size={14} aria-hidden="true"/>}
     </MenuItem>)}
    </Menu>
    {(onConfigure||clear)&&<footer className="workspace-model-menu-footer">
    {onConfigure&&<Button type="button" size="sm" color="tertiary" iconLeading={Settings2} isDisabled={disabled} onPress={()=>{setOpen(false);onConfigure();}}>{uiText("配置制作服务")}</Button>}
    {clear&&<Button size="xs" color="tertiary" isDisabled={disabled} onPress={()=>{setOpen(false);onChange('');}}>{uiText(clearLabel)}</Button>}
    </footer>}
   </Dialog>
  </Popover>
 </DialogTrigger>;
}
