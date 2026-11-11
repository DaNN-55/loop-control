import {useState} from 'react';
import {Dialog,DialogTrigger,Menu,MenuItem,Popover} from 'react-aria-components';
import {Check,ChevronDown,Mic,X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {WorkspaceModelLogo} from './WorkspaceModelLogo';
import './workspace-generation-composer.css';

export interface WorkspaceModelOption {id:string;label:string;provider?:string;connection?:string;searchText?:string;disabled?:boolean;manual?:boolean}
export function WorkspaceModelPicker({label,title,searchLabel,searchPlaceholder='搜索模型、服务商或连接',closeLabel='关闭模型选择',noResults='没有匹配模型。',options,value,disabled,onChange,empty,clear,clearLabel='清除模型选择',compact=true}:{label:string;title:string;searchLabel:string;searchPlaceholder?:string;closeLabel?:string;noResults?:string;options:WorkspaceModelOption[];value:string;disabled?:boolean;onChange:(id:string)=>void;empty?:string;clear?:boolean;clearLabel?:string;compact?:boolean}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 const selected=options.find(option=>option.id===value),duplicates=new Set(options.filter((option,index)=>options.some((other,i)=>i!==index&&other.label===option.label)).map(option=>option.label));
 const visible=options.filter(option=>`${option.label} ${option.connection??''} ${option.searchText??''}`.toLowerCase().includes(query.trim().toLowerCase()));
 return <DialogTrigger isOpen={open} onOpenChange={next=>{setOpen(next);if(next)setQuery('');}}>
  <Button size={compact?'xs':'sm'} color="tertiary" className="workspace-composer-chip workspace-model-picker-trigger" aria-label={label} title={selected?.connection?`${selected.label} · ${selected.connection}`:undefined} isDisabled={disabled} iconTrailing={ChevronDown}>
   {selected&&(selected.manual?<Mic size={16} aria-hidden="true"/>:<WorkspaceModelLogo model={selected.label} provider={selected.provider}/>)}{selected?.label??title}
  </Button>
  <Popover className="dan-ui product-ui workspace-composer-popover workspace-composer-model-popover" placement="top start" offset={8} containerPadding={12} shouldFlip>
   <Dialog aria-label={title} className="workspace-composer-settings">
    <header><h3>{title}</h3><Button size="xs" color="tertiary" aria-label={closeLabel} iconLeading={X} onPress={()=>setOpen(false)}/></header>
    <input type="search" className="workspace-composer-model-search" aria-label={searchLabel} placeholder={searchPlaceholder} value={query} onChange={event=>setQuery(event.target.value)}/>
    <Menu aria-label={label.replace('连接与模型','可用模型')} className="workspace-composer-model-list" selectionMode="single" selectedKeys={value?[value]:[]} disabledKeys={options.filter(option=>option.disabled).map(option=>option.id)} onAction={key=>{setOpen(false);onChange(String(key));}} renderEmptyState={()=><p role="status">{options.length?noResults:empty??'暂无可用模型。'}</p>}>
     {visible.map(option=><MenuItem key={option.id} id={option.id} textValue={`${option.label}${duplicates.has(option.label)?` ${option.connection??''}`:''}`} className="workspace-composer-model-option">
      {option.manual?<Mic size={16} aria-hidden="true"/>:<WorkspaceModelLogo model={option.label} provider={option.provider}/>}<strong title={option.connection}>{option.label}</strong>{duplicates.has(option.label)&&<small>{option.connection}</small>}{option.id===value&&<Check size={14} aria-hidden="true"/>}
     </MenuItem>)}
    </Menu>
    {clear&&<Button size="xs" color="tertiary" isDisabled={disabled} onPress={()=>{setOpen(false);onChange('');}}>{clearLabel}</Button>}
   </Dialog>
  </Popover>
 </DialogTrigger>;
}
