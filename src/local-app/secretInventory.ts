import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import type {SecretMetadata} from './secretAdministrationTypes.js';
export const secretReferencePattern=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const controlReference='system:unlock-anchor';
interface NamedReference {reference:string;previous?:string[]}
interface Index {version:number;entries:Record<string,NamedReference>;nameAliases?:Record<string,NamedReference>;referenceAliases?:Record<string,string>;historicalLiterals?:Record<string,unknown>}
export interface ReferenceInventory {
 connections:({reference:string}&SecretMetadata['connections'][number])[];
 intents:{reference:string;name:string|null;operation:string|null}[];
 history:{reference:string;occurrences:number}[];
 files:{sha256:string;bytes:string|number;logical_path:string}[];
}
export interface SecretInventoryConfiguration {runtimeRoot:string;controlReferences:{reference:string;purpose:string}[]}
export class SecretInventory {
 private fileReferences=new Map<string,string[]>();
 constructor(private config:SecretInventoryConfiguration){}
 private async index():Promise<Index>{
  const root=this.config.runtimeRoot,path=join(root,'secret-index.json');
  if(!root.endsWith('/.loop-control/local'))throw Error('Secret inventory unavailable');
  for(const item of [root,path]){const stat=await lstat(item);if(stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||await realpath(item)!==item)throw Error('Secret inventory unavailable');}
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await fd.stat();if(!stat.isFile()||stat.size>16*1024*1024)throw Error();const value=JSON.parse(await fd.readFile('utf8'))as Index;
   if(value.version!==1||!value.entries||Array.isArray(value.entries))throw Error();
   for(const [name,row]of Object.entries({...value.entries,...value.nameAliases})){if(!name||name.length>2048||!secretReferencePattern.test(row.reference)||row.previous?.some(v=>!secretReferencePattern.test(v)))throw Error();}
   for(const[a,b]of Object.entries(value.referenceAliases??{}))if(!secretReferencePattern.test(a)||!secretReferencePattern.test(b))throw Error();
   return value;
  }finally{await fd.close();}
 }
 private async markers(file:ReferenceInventory['files'][number]):Promise<string[]>{
  const cached=this.fileReferences.get(file.sha256);if(cached)return cached;
  if(!/^[a-f0-9]{64}$/.test(file.sha256)||Number(file.bytes)>512*1024*1024)throw Error('History reference inventory unavailable');
  const path=join(this.config.runtimeRoot,'history/content',file.sha256),stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==Number(file.bytes)||await realpath(path)!==path)throw Error('History reference inventory unavailable');
  const refs=new Set<string>(),hash=createHash('sha256');let tail='';
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{for await(const bytes of handle.createReadStream({highWaterMark:65536})){
   hash.update(bytes);const text=tail+bytes.toString('utf8');for(const m of text.matchAll(/keychain:([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/g))refs.add(m[1]);tail=text.slice(-64);
  }}finally{await handle.close();}
  if(hash.digest('hex')!==file.sha256)throw Error('History reference inventory unavailable');
  const result=[...refs];if(this.fileReferences.size>=16000)this.fileReferences.delete(this.fileReferences.keys().next().value!);this.fileReferences.set(file.sha256,result);return result;
 }
 async read(inventory:ReferenceInventory):Promise<SecretMetadata[]>{
  const index=await this.index(),aliases=index.referenceAliases??{},rows=new Map<string,SecretMetadata>();
  const canonical=(reference:string)=>{const seen=new Set<string>();while(Object.hasOwn(aliases,reference)){if(seen.has(reference))throw Error('Invalid secret aliases');seen.add(reference);reference=aliases[reference];}return reference;};
  const row=(reference:string)=>{if(!secretReferencePattern.test(reference))throw Error('Invalid secret metadata');const key=canonical(reference);let item=rows.get(key);if(!item){item={reference:key,names:[],aliases:[],purpose:'尚未发现当前引用',category:'unreferenced',runtimeUses:[],connections:[],pendingUses:[],history:{metadataOccurrences:0,fileOccurrences:0,files:[]},revealAllowed:true,state:'未读取密钥值'};rows.set(key,item);}if(reference!==key&&!item.aliases.includes(reference))item.aliases.push(reference);return item;};
  for(const[name,entry]of Object.entries({...index.entries,...index.nameAliases})){row(entry.reference).names.push(name);for(const previous of entry.previous??[])row(previous).names.push(name+'（索引旧版本）');}
  for(const[reference,target]of Object.entries(aliases)){row(reference);row(target);}
  for(const use of this.config.controlReferences){const item=row(use.reference);item.runtimeUses.push(use.purpose);item.revealAllowed=false;}
  for(const use of inventory.connections){const{reference,...metadata}=use;row(reference).connections.push(metadata);}
  for(const use of inventory.intents)row(use.reference).pendingUses.push(use.name??use.operation??'未完成连接操作');
  for(const use of inventory.history)row(use.reference).history.metadataOccurrences+=Number(use.occurrences);
  // Scan only immutable protected content for references, never resolve values.
  // Four readers cap file descriptors/memory; subsequent reads reuse SHA-keyed references.
  let cursor=0;await Promise.all(Array.from({length:4},async()=>{while(cursor<inventory.files.length){const file=inventory.files[cursor++];for(const reference of await this.markers(file)){const item=row(reference);item.history.fileOccurrences++;if(item.history.files.length<3)item.history.files.push(file.logical_path);}}}));
  for(const item of rows.values()){
   item.names=[...new Set(item.names)];const current=item.connections.filter(c=>c.current&&!c.revoked);
   const history=item.history.metadataOccurrences+item.history.fileOccurrences;
   item.category=!item.revealAllowed?'system':current.length||item.pendingUses.length?'connection':history?'history':item.connections.length?'connection':'unreferenced';
   item.purpose=item.runtimeUses.length?item.runtimeUses.join('；'):current.length?'当前连接：'+current.map(c=>c.name).join('、'):history?'历史原文还原':item.connections.length?'连接历史版本':item.pendingUses.length?'恢复未完成连接操作':'当前核查未发现引用';
   if(!item.names.length)item.names=[item.connections[0]?.name??'无索引名称的引用条目'];
   if(!item.revealAllowed)item.state='系统控制凭据，仅展示元数据';
  }
  return [...rows.values()].filter(item=>!Object.hasOwn(index.historicalLiterals??{},item.reference)).concat([{reference:controlReference,names:['专用 Keychain 启动解锁锚点'],aliases:[],purpose:'启动时解锁专用库；锚点由登录 Keychain 的固定 helper 管理',category:'system',runtimeUses:['专用库启动控制'],connections:[],pendingUses:[],history:{metadataOccurrences:0,fileOccurrences:0,files:[]},revealAllowed:false,state:'系统控制条目，不提供网页读取'}as SecretMetadata]).sort((a,b)=>a.names[0].localeCompare(b.names[0],'zh-CN'));
 }
}
