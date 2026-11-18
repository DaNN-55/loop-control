import {legacyScriptStudioChatInitial} from '../scriptStudioLegacy';
import {useEffect,useId,useRef,type CSSProperties} from 'react';
import {PanelRightClose,PanelRightOpen,Brain,ArrowUp,Clapperboard,MessagesSquare,Bot,Pencil} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Tooltip} from '../ui/dan-ui/components/base/tooltip/tooltip';
import {scriptStudioReasoningLabels} from '../scriptStudioReasoning';
import {uiText} from '../i18n/ui';
import type {ScriptStudioChatMode,ScriptStudioResult} from '../scriptStudio';
import type {useScriptStudioAssistant} from './useScriptStudioAssistant';
import {useWorkspaceDraft} from './WorkspaceDraft';
import {ScriptStudioIcon,ScriptStudioModel,ScriptStudioModelLogo,ScriptStudioPopup} from './ScriptStudioTools';

export function ScriptStudioChat({assistant,episodeId,revisionId,disabled,collapsed,onCollapse,modelOpen,onModelOpen,onSend}:{assistant:ReturnType<typeof useScriptStudioAssistant>;episodeId:string;revisionId:string|null;disabled:boolean;collapsed:boolean;onCollapse:()=>void;modelOpen:boolean;onModelOpen:(value:boolean)=>void;onSend:(mode:ScriptStudioChatMode,instruction:string,previousRequestId?:string)=>Promise<ScriptStudioResult|undefined>}){
 const draft=useWorkspaceDraft({episodeId,kind:'script',version:'chat:'+(revisionId??'new'),initial:{instruction:'',mode:'adjust'},legacyInitial:legacyScriptStudioChatInitial,enabled:!disabled}),{instruction,mode}=draft.value;
 const id=useId(),log=useRef<HTMLOListElement>(null),atBottom=useRef(true);
 const waiting=disabled||assistant.busy||assistant.conversationLoading||!!assistant.conversationError,discuss=mode==='discuss';
 const label=assistant.unresolved?'核对本次请求':assistant.busy?(assistant.activity==='discuss'?'正在回复…':'正在设计拍法…'):discuss?'发送':assistant.result?'生成新版':'优化拍法';
 useEffect(()=>{if(atBottom.current&&log.current)log.current.scrollTop=log.current.scrollHeight;},[assistant.turns.length,assistant.busy]);
 async function send(kind:ScriptStudioChatMode,text:string,parent?:string){atBottom.current=true;const submitted={...draft.value},value=await onSend(kind,text,parent);if(value?.status==='completed'){draft.acknowledge(submitted,{...submitted,instruction:''});}}
 function submit(){if(waiting)return;if(assistant.unresolved){void assistant.send();return;}if((discuss||assistant.result)&&!instruction.trim())return;const parent=assistant.latestRequestId??assistant.result?.requestId;void send(discuss?'discuss':'optimize',instruction.trim(),parent);}
 const configDisabled=waiting||assistant.unresolved;

 return <aside className="script-studio-chat" aria-label={uiText('拍法助手')}>
  <header className="script-studio-pane-heading script-studio-chat-heading">{!collapsed&&<h4>{uiText('拍法助手')}</h4>}<ScriptStudioIcon label={collapsed?'展开拍法助手':'收起拍法助手'} icon={collapsed?PanelRightOpen:PanelRightClose} onPress={onCollapse}/></header>
  {!collapsed&&<div className="script-studio-chat-body">

   {assistant.conversationLoading&&<p role="status">{uiText('正在读取对话…')}</p>}
   {assistant.conversationError&&<div><p role="alert" className="form-error">{assistant.conversationError}</p><Button type="button" size="sm" color="tertiary" onPress={()=>void assistant.restoreConversation()}>{uiText('重新读取对话')}</Button></div>}
   <ol ref={log} className="script-studio-chat-messages" aria-label={uiText('拍法对话记录')} aria-live={assistant.conversationLoading?'off':'polite'} onScroll={()=>{const node=log.current;if(node)atBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<40;}}>
    {assistant.turns.map(turn=><li key={turn.requestId}><div className="script-studio-chat-user" role="group" aria-label={uiText('你的消息')}><p>{turn.instruction}</p></div><div className="script-studio-chat-assistant"><div className="script-studio-chat-assistant-heading">{turn.mode==='edit'?<><Pencil size={14} aria-hidden="true"/><span>{uiText('本地修改')}</span></>:turn.model?<><ScriptStudioModelLogo model={turn.model} provider={turn.provider??(turn.model.startsWith('deepseek')?'deepseek':'openai')}/><span>{turn.model}</span></>:<><Bot size={14} aria-hidden="true"/><span>AI</span></>}</div><div className="script-studio-chat-answer"><p>{turn.answer}</p>{turn.status!=='completed'&&<span className="script-studio-chat-outcome">{uiText(turn.status==='unknown'?'结果未知，请核对':turn.status==='pending'?'处理中，请核对':'本次请求未完成')}</span>}</div></div></li>)}
   </ol>
   {!assistant.turns.length&&!assistant.conversationLoading&&<p className="script-studio-chat-empty">{uiText('直接优化拍法，或先讨论你的想法。')}</p>}
   <form className="script-studio-chat-form" aria-label={uiText('拍法对话')} onSubmit={event=>{event.preventDefault();submit();}}>
    <label className="script-studio-chat-label" htmlFor={id}>{uiText('修改要求')}</label><textarea id={id} name="instruction" value={instruction} maxLength={2000} rows={3} disabled={waiting||assistant.unresolved} onChange={event=>draft.setValue(previous=>({...previous,instruction:event.target.value}))} placeholder={uiText(discuss?'讨论拍法，不修改分镜…':'描述想调整的拍法…')}/>
    <div className="script-studio-chat-controls">
     <ScriptStudioModel assistant={assistant} disabled={configDisabled} open={modelOpen} onOpenChange={onModelOpen}/>
     <ScriptStudioPopup label="推理强度" trigger={<ScriptStudioIcon label={'推理强度：'+scriptStudioReasoningLabels[assistant.reasoningEffort]} tip={assistant.choice?'推理强度：'+scriptStudioReasoningLabels[assistant.reasoningEffort]:'先选择模型，再设置推理强度'} icon={Brain} active={assistant.reasoningEffort!=='none'} disabled={configDisabled||!assistant.reasoningOptions.length}/>}>
      <div className="script-studio-effort-slider"><label className="script-studio-chat-label" htmlFor={id+'effort'}>{uiText('推理强度')}</label><input id={id+'effort'} type="range" style={{'--slider-progress':`${Math.max(0,assistant.reasoningOptions.indexOf(assistant.reasoningEffort))/Math.max(1,assistant.reasoningOptions.length-1)*100}%`} as CSSProperties} min={0} max={Math.max(0,assistant.reasoningOptions.length-1)} step={1} value={Math.max(0,assistant.reasoningOptions.indexOf(assistant.reasoningEffort))} aria-valuetext={uiText(scriptStudioReasoningLabels[assistant.reasoningEffort])} disabled={configDisabled} onChange={event=>{const value=assistant.reasoningOptions[Number(event.target.value)];if(value)assistant.chooseReasoning(value);}}/><div className="script-studio-effort-ticks" aria-hidden="true">{assistant.reasoningOptions.map(effort=><span key={effort}>{uiText(scriptStudioReasoningLabels[effort])}</span>)}</div></div>
     </ScriptStudioPopup>
     <ScriptStudioPopup label="聊天设置" trigger={<ScriptStudioIcon label={discuss?'交流方式：仅讨论':'交流方式：调整拍法'} tip={discuss?'仅讨论 · 不修改分镜':'调整拍法 · 生成新版待采用'} icon={discuss?MessagesSquare:Clapperboard} active disabled={configDisabled}/>}>
      <div className="script-studio-chat-mode" role="group" aria-label={uiText('交流方式')}>{[{value:'adjust',label:'调整拍法',icon:Clapperboard},{value:'discuss',label:'仅讨论',icon:MessagesSquare}].map(option=><Button key={option.value} type="button" size="sm" color="tertiary" iconLeading={option.icon} isDisabled={configDisabled} aria-pressed={mode===option.value} onPress={()=>draft.setValue(previous=>({...previous,mode:option.value}))}>{uiText(option.label)}</Button>)}</div>
      <p>{uiText('发送会使用所选模型并产生调用费用。仅讨论不会修改分镜；生成新版仍需采用。')}</p>
     </ScriptStudioPopup>
     <Tooltip title={uiText(label)}><Button type="submit" size="sm" color="primary" className="script-studio-chat-submit" aria-label={uiText(label)} iconLeading={ArrowUp} isDisabled={waiting||!assistant.unresolved&&(discuss&&!instruction.trim()||!!assistant.result&&!instruction.trim())}/></Tooltip>
    </div>
   </form>
   {assistant.needsChoice&&<p role="status">{uiText('请选择模型，再生成拍法。')}</p>}

   {draft.storageError&&<p role="alert" className="form-error">{uiText('对话草稿暂无法保存，请保持页面打开。')}</p>}
   {assistant.error&&!disabled&&<p role="alert" className="form-error">{assistant.error}</p>}
  </div>}

 </aside>;
}
