import {useSyncExternalStore} from 'react';
import {englishMessages} from './en';
import {dynamicMessages} from './en/dynamic';
import type {UiLocale} from './types';
export type {UiLocale} from './types';
let locale:UiLocale='zh-CN';
const listeners=new Set<()=>void>();
export const getUiLocale=()=>locale;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
/** Root subscribes once so locale changes rerender the product's explicit UI strings. */
export function useUiLocale(){return useSyncExternalStore(subscribe,getUiLocale,()=> 'zh-CN' as const);}
export function setUiLocale(next:UiLocale){if(next===locale)return;locale=next;listeners.forEach(listener=>listener());}
// Feedback is stored in its source language so a later locale switch can render it again.
// Match only explicit product templates, preserving captured names and technical values.
const feedbackTemplates=Object.keys(dynamicMessages).map(source=>{
 const names:string[]=[],parts=source.split(/(\{[A-Za-z]\w*\})/g);
 const pattern=parts.map(part=>/^\{[A-Za-z]\w*\}$/.test(part)?(names.push(part.slice(1,-1)),'([\\s\\S]*?)'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
 return{source,names,pattern:new RegExp('^'+pattern+'$'),specificity:source.replace(/\{[^}]+\}/g,'').length};
}).sort((a,b)=>b.specificity-a.specificity);
/** Call only for product-owned copy; user content, credentials and raw logs stay untouched. */
export function uiText(source:string,values?:Record<string,string|number>):string{
 const template=locale==='en-US'?(englishMessages[source]??source):source;
 if(locale==='en-US'&&!values&&!Object.hasOwn(englishMessages,source)&&/[\u3400-\u9fff]/.test(source)){
  for(const entry of feedbackTemplates){const match=entry.pattern.exec(source);if(!match)continue;const captured=Object.fromEntries(entry.names.map((name,index)=>[name,match[index+1]]));return (englishMessages[entry.source]??entry.source).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(token,key:string)=>captured[key]??token);}
 }
 return values?template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(match,key:string)=>Object.prototype.hasOwnProperty.call(values,key)?String(values[key]):match):template;
}
