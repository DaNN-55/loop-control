import {useState} from 'react';
import {uiText} from '../i18n/ui';
import type {WorkspaceSourceOptions,WorkspaceSourceReference} from '../workspaceSourceOptions';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';

export function WorkspaceSourcePicker({options,pending,onImport}:{options:WorkspaceSourceOptions;pending:boolean;onImport:(source:WorkspaceSourceReference)=>Promise<void>}){
 const [selected,setSelected]=useState(''),choice=options.options.find(o=>o.id===selected);
 if(!options.options.length)return null;
 return <section className="production-workspace-section workspace-source-options" aria-label={uiText("接入已有作品")}>
  <header><h3>{uiText("接入已有作品")}</h3><div><label>{uiText("接入来源")}<NativeSelect size="sm" name="workspaceSource" disabled={pending} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{uiText("选择接入来源")}</option>{options.options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect></label><Button size="sm" color="primary" isDisabled={pending||!choice?.source} onPress={()=>{if(choice?.source)void onImport(choice.source).catch(()=>{});}}>{pending?uiText("正在接入…"):uiText("接入当前制作")}</Button></div></header>
  {choice?<p role={choice.unavailableReason?'status':undefined}>{choice.unavailableReason??choice.summary}</p>:<p>{uiText("选择原版本继续制作，原资料保留。")}</p>}
 </section>;
}
