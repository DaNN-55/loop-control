import {uiText} from '../i18n/ui';
import {useId,useRef,useState,useLayoutEffect,type Ref} from 'react';
import type {PromptReferenceInput} from '../promptReferences';
import './workspace-generation-form.css';

export function WorkspacePromptField({label,ariaLabel,value,limit,disabled,onChange,placeholder,inputRef,rows=4,mentions}:{label:string;ariaLabel:string;value:string;limit:number;disabled?:boolean;onChange:(value:string)=>void;placeholder?:string;inputRef?:Ref<HTMLTextAreaElement>;rows?:number;mentions?:Array<PromptReferenceInput&{token:string}>}){
 const id=useId(),near=value.length>=limit*.9,over=value.length>limit;
 const textarea=useRef<HTMLTextAreaElement|null>(null),[range,setRange]=useState<{start:number;end:number;query:string;typed?:boolean}|null>(null),[active,setActive]=useState(0);
 const pendingCaret=useRef<number|null>(null);
 useLayoutEffect(()=>{if(pendingCaret.current!==null&&textarea.current){const caret=pendingCaret.current;pendingCaret.current=null;textarea.current.focus();textarea.current.setSelectionRange(caret,caret);}},[value]);
 const options=(mentions??[]).filter(option=>!range?.query||`${option.token} ${option.name}`.toLowerCase().includes(range.query.toLowerCase()));
 function inspect(text:string,caret:number){const match=text.slice(0,caret).match(/@([^@\s，。！？、]*)$/);setRange(match?{start:caret-match[0].length,end:caret,query:match[1],typed:true}:null);setActive(0);}
 function insert(option:NonNullable<typeof mentions>[number]){
  const input=textarea.current;if(!input)return;
  const start=range?.start??input.selectionStart,end=range?.end??input.selectionEnd,next=value.slice(0,start)+option.token+' '+value.slice(end);
  pendingCaret.current=start+option.token.length+1;setRange(null);onChange(next);
 }
 return <div className="workspace-prompt-field"><label htmlFor={id+'-input'}>{label}</label><textarea id={id+'-input'} ref={node=>{textarea.current=node;if(typeof inputRef==='function')inputRef(node);else if(inputRef)inputRef.current=node;}} aria-label={ariaLabel} aria-describedby={[near?id:null,mentions?id+'-hint':null].filter(Boolean).join(' ')||undefined} aria-invalid={over||undefined} aria-controls={range?id+'-references':undefined} aria-activedescendant={range&&options.length?id+'-option-'+active:undefined} rows={rows} disabled={disabled} value={value} onChange={event=>{onChange(event.target.value);if(mentions&&!(event.nativeEvent as InputEvent).isComposing)inspect(event.target.value,event.target.selectionStart);}} onCompositionEnd={event=>{if(mentions)inspect(event.currentTarget.value,event.currentTarget.selectionStart);}} onSelect={event=>{if(range?.typed)inspect(event.currentTarget.value,event.currentTarget.selectionStart);}} onBlur={event=>{if(!event.currentTarget.parentElement?.contains(event.relatedTarget))setRange(null);}} onKeyDown={event=>{
  if(!range||event.nativeEvent.isComposing)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setRange(null);}
  else if(options.length&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();setActive(index=>(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);}
  else if(options.length&&event.key==='Enter'&&!event.shiftKey){event.preventDefault();insert(options[active]??options[0]);}
 }} placeholder={placeholder}/>
 {mentions&&<div className="workspace-prompt-reference-footer"><button type="button" disabled={disabled||!mentions.length} onClick={()=>{const input=textarea.current;if(input){setRange({start:input.selectionStart,end:input.selectionEnd,query:''});setActive(0);input.focus();}}} aria-label={uiText("插入参考素材")}>{uiText("@ 参考素材")}</button><small id={id+'-hint'}>{mentions.length?uiText("输入 @ 引用已添加素材"):uiText("添加参考素材后可用 @ 引用")}</small></div>}
 {mentions&&range&&<div id={id+'-references'} className="workspace-prompt-mentions" role="listbox" aria-label={uiText("可引用素材")}>{options.map((option,index)=><button type="button" role="option" id={id+'-option-'+index} key={option.materialRevisionId} aria-selected={active===index} onMouseDown={event=>event.preventDefault()} onClick={()=>insert(option)}><strong>{option.token}</strong><span>{option.name}</span></button>)}{!options.length&&<p role="status">{mentions.length?uiText("没有匹配的参考素材"):uiText("请先添加参考素材")}</p>}</div>}
 {near&&<span id={id} className={`workspace-prompt-count${over?' is-over':''}`} role={over?'alert':'status'}><span>{value.length.toLocaleString('en-US')} / {limit.toLocaleString('en-US')}{uiText(" 字符")}</span><span>{over?uiText("{value0}超出 {value1} 个字符，请精简后提交。",{value0:String(label),value1:String((value.length-limit).toLocaleString('en-US'))}):uiText("接近输入上限；账号、系列规则与参考要求合并后还需通过服务校验。")}</span></span>}</div>;
}
