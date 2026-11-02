import {useId,type Ref} from 'react';
import './workspace-generation-form.css';

export function WorkspacePromptField({label,ariaLabel,value,limit,disabled,onChange,placeholder,inputRef,rows=4}:{label:string;ariaLabel:string;value:string;limit:number;disabled?:boolean;onChange:(value:string)=>void;placeholder?:string;inputRef?:Ref<HTMLTextAreaElement>;rows?:number}){
 const id=useId(),near=value.length>=limit*.9,over=value.length>limit;
 return <label className="workspace-prompt-field">{label}<textarea ref={inputRef} aria-label={ariaLabel} aria-describedby={near?id:undefined} aria-invalid={over||undefined} rows={rows} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder}/>{near&&<span id={id} className={`workspace-prompt-count${over?' is-over':''}`} role={over?'alert':'status'}><span>{value.length.toLocaleString('en-US')} / {limit.toLocaleString('en-US')} 字符</span><span>{over?`${label}超出 ${(value.length-limit).toLocaleString('en-US')} 个字符，请精简后提交。`:'接近输入上限；账号、系列规则与参考要求合并后还需通过服务校验。'}</span></span>}</label>;
}
