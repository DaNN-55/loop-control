import {createHash} from 'node:crypto';
/** Retry-stable identities are local to one explicit save intent. */
export function productionCopyId(copyId:string,sourceId:string){const h=createHash('sha256').update(copyId+'\0'+sourceId).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
const authoredText=new Set(['text','name','title','description','instruction','narration','narration_text','text_version','main_script_text','scriptSegment','baseline_text','visual','videoPrompt','soundIntent']);
export function remapProductionCopy<T>(input:T,mapping:Record<string,string>):T{
 const identifiers=Object.entries(mapping).filter(([old])=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(old));
 const visit=(v:unknown,key=''):unknown=>{
  if(typeof v==='string'){
   if(authoredText.has(key))return v;
   if(Object.hasOwn(mapping,v))return mapping[v];
   if(/(?:^id$|Id$|_id$|Ids$|itemId|sourceAssetId|preparationRevisionId|inputFingerprint)/.test(key))for(const[old,next]of identifiers)v=(v as string).replaceAll(old,next);
   return v;
  }
  if(Array.isArray(v))return v.map(item=>visit(item,key));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([key])=>key!=='originalFilePath').map(([key,item])=>[mapping[key]??key,visit(item,key)]));
  return v;
 };return visit(input) as T;
}
