import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {copyFile,lstat,mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,extname,join} from 'node:path';
import {ConfigurationError} from './configurationCommands.js';
import type {OpenChatCutProject} from '../worker/openchatcutProject.js';
import {openOpenChatCutDraftStudio,closeOpenChatCutStudio,openStandaloneOpenChatCutStudio,closeStandaloneOpenChatCutStudio,inspectOpenChatCutStoredProject,type OpenChatCutRuntimeConfig} from '../worker/openchatcutStudio.js';
import {safeAssetOutputPath} from '../worker/controlledMediaExecutor.js';
import {fileSha256} from '../worker/fileSha256.js';
import type {CompletedStudioCopy} from './completedStudioCopy.js';

export interface CompletedStudioSource {project:OpenChatCutProject;sha256:string;title:string;sources:Array<{reference:string;path:string;sha256:string;fileSize:number}>}
interface Copy {ownerId:string;episodeId:string;runtimeId:string;root:string;session:CompletedStudioCopy;title:string;runtime:OpenChatCutRuntimeConfig;timer:ReturnType<typeof setTimeout>;busy:boolean;saved?:{projectId:string;studioUrl:string}}
/** Only newly allocated copy roots and newly allocated standalone media can be written. */
export class CompletedStudioCopies {
 private copies=new Map<string,Promise<Copy>>();
 private libraries=new Set<string>();
 constructor(private mediaRoot:string,private runtime:()=>Promise<OpenChatCutRuntimeConfig>,private load:(owner:string,episode:string)=>Promise<CompletedStudioSource>){}
 async open(ownerId:string,episodeId:string,copyId:string):Promise<CompletedStudioCopy>{
  const previous=this.copies.get(copyId);if(previous){const copy=await previous;this.authorize(copy,ownerId,episodeId);this.touch(copy);return copy.session;}
  if(this.copies.size>=4)throw new ConfigurationError(409,'请先关闭已有的查看副本。');
  const opening=this.create(ownerId,episodeId,copyId);this.copies.set(copyId,opening);
  try{return(await opening).session;}catch(error){if(this.copies.get(copyId)===opening)this.copies.delete(copyId);throw error;}
 }
 private async create(ownerId:string,episodeId:string,copyId:string):Promise<Copy>{
  const source=await this.load(ownerId,episodeId),runtime=await this.runtime();
  const runtimeId=randomUUID(),root=await realpath(await mkdtemp(join(tmpdir(),'loop-completed-studio-'))),references=new Map<string,string>();
  try{
   const directory=join(root,'episodes',runtimeId,'media');await mkdir(directory,{recursive:true});
   for(const file of source.sources){
    const relative=`episodes/${runtimeId}/media/${createHash('sha256').update(file.reference).digest('hex')}${extname(file.reference)}`;
    await copyFile(file.path,join(root,relative),constants.COPYFILE_FICLONE);
    const stat=await lstat(join(root,relative));
    if(stat.size!==file.fileSize||await fileSha256(join(root,relative))!==file.sha256)throw new ConfigurationError(409,'原素材已变化，未打开查看副本。');
    references.set(file.reference,relative);
   }
   const document=copyDocument(source.project,value=>{const mapped=references.get(value);if(!mapped)throw new ConfigurationError(409,'工程存在未校验的素材来源。');return mapped;});
   const opened=await openOpenChatCutDraftStudio(root,runtimeId,document,[...references.values()],source.sha256,{...runtime,projectName:source.title+'（查看副本）',environment:{...(runtime.environment??process.env),LOOP_OPENCHATCUT_VIEW_COPY:'1'}});
   if(!opened.studioUrl)throw Error('未收到 OpenChatCut 地址。');
   const copy={ownerId,episodeId,runtimeId,root,runtime,title:source.title,busy:false,session:{...opened,studioUrl:opened.studioUrl,copyId,sourceSha256:source.sha256,sourcePath:opened.workspace.relativePath}} as Copy;
   this.touch(copy);return copy;
  }catch(error){await closeOpenChatCutStudio(runtimeId);await rm(root,{recursive:true,force:true});throw error;}
 }
 private authorize(copy:Copy,ownerId:string,episodeId:string){if(copy.ownerId!==ownerId||copy.episodeId!==episodeId)throw new ConfigurationError(404,'查看副本不可见。');}
 private touch(copy:Copy){clearTimeout(copy.timer);copy.timer=setTimeout(()=>{void this.discard(copy.ownerId,copy.episodeId,copy.session.copyId).catch(()=>{});},30*60*1000);copy.timer.unref();}
 async heartbeat(ownerId:string,episodeId:string,id:string){const copy=await this.require(ownerId,episodeId,id);this.touch(copy);return{active:true};}
 private async require(ownerId:string,episodeId:string,id:string){const entry=this.copies.get(id);if(!entry)throw new ConfigurationError(404,'查看副本已关闭，请重新打开。');const copy=await entry;this.authorize(copy,ownerId,episodeId);return copy;}
 async discard(ownerId:string,episodeId:string,id:string){
  const copy=await this.require(ownerId,episodeId,id);if(copy.busy)throw new ConfigurationError(409,'请等待副本保存完成。');
  copy.busy=true;clearTimeout(copy.timer);
  try{await closeOpenChatCutStudio(copy.runtimeId);await rm(copy.root,{recursive:true,force:true});this.copies.delete(id);return{closed:true};}
  catch(error){this.touch(copy);throw error;}finally{copy.busy=false;}
 }
 async keep(ownerId:string,episodeId:string,id:string){
  const copy=await this.require(ownerId,episodeId,id);if(copy.busy)throw new ConfigurationError(409,'请等待副本保存完成。');
  copy.busy=true;this.touch(copy);
  try{
   if(copy.saved)return copy.saved;
   let project:OpenChatCutProject;
   try{
    const privateOrigin=new URL(copy.session.studioUrl).origin;
    const response=await fetch(privateOrigin+'/api/project-store/entry?key='+encodeURIComponent('project:'+copy.session.workspace.projectId),{headers:{'Sec-Fetch-Site':'none'}});
    if(!response.ok)throw Error('副本读取失败。');
    const value=await response.json() as {found?:boolean;value:OpenChatCutProject};if(!value.found)throw Error('副本已失效。');project=value.value;
   }catch{
    // A dead native process still leaves its last acknowledged autosave in the private store.
    await closeOpenChatCutStudio(copy.runtimeId);
    const stored=await inspectOpenChatCutStoredProject(copy.root,copy.runtimeId);if(!stored)throw Error('副本自动保存记录不可用，请保留当前窗口。');
    const reverse=new Map(Object.entries(stored.metadata.reverseSources).map(([remote,local])=>[local,remote]));
    project=copyDocument(stored.project,source=>reverse.get(source)??source);
   }
   const library=join(this.mediaRoot,'openchatcut','standalone',ownerId),projectId='completed-copy-'+id,media=new Map<string,string>();
   const document=copyDocument(project,source=>{
    if(!/^\/media\/uploads\/[a-zA-Z0-9_.-]+$/.test(source))throw Error('副本包含无法独立保存的媒体来源。');
    const remote='/media/uploads/'+id+'-'+basename(source);media.set(source,remote);return remote;
   });
   this.libraries.add(library);const {studioUrl}=await openStandaloneOpenChatCutStudio(library,copy.runtime);
   // The same stable ID lets an uncertain import be verified without overwriting an existing document.
   const existing=await fetch(studioUrl+'api/project-store/entry?key='+encodeURIComponent('project:'+projectId),{headers:{'Sec-Fetch-Site':'none'}});
   if(!existing.ok)throw Error('独立剪辑库读取失败。');
   const prior=await existing.json() as {found:boolean;value:unknown};
   if(prior.found&&JSON.stringify(prior.value)!==JSON.stringify(document))throw Error('独立副本已有新修改，未覆盖；请从独立剪辑库查看。');
   for(const [source,target] of media){
    const path=join(copy.root,'episodes',copy.runtimeId,'openchatcut-work/current/runtime',source.slice(1)),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('副本媒体不是安全普通文件。');
    const destination=await safeAssetOutputPath(library,target.slice(1));await copyFile(path,destination,constants.COPYFILE_FICLONE);
    if(await fileSha256(path)!==await fileSha256(destination))throw Error('独立副本媒体校验失败。');
   }
   const index={id:projectId,name:copy.title+'（独立副本）',updatedAt:Date.now()};
   const imported=await fetch(studioUrl+'api/project-store/merge',{method:'POST',headers:{Origin:new URL(studioUrl).origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'},body:JSON.stringify({entries:{projects:[index],...(!prior.found?{['project:'+projectId]:document}:{})}})});
   if(!imported.ok)throw Error('独立副本保存未确认，请保留当前窗口重试。');
   const stored=await fetch(studioUrl+'api/project-store/entry?key='+encodeURIComponent('project:'+projectId),{headers:{'Sec-Fetch-Site':'none'}});
   const verified=await stored.json() as {found:boolean;value:unknown};if(!stored.ok||!verified.found||JSON.stringify(verified.value)!==JSON.stringify(document))throw Error('独立副本尚未核实，请保留当前窗口重试。');
   const listed=await fetch(studioUrl+'api/project-store/entry?key=projects',{headers:{'Sec-Fetch-Site':'none'}});
   const listing=await listed.json() as {found:boolean;value:Array<{id:string}>};if(!listed.ok||!listing.found||!Array.isArray(listing.value)||!listing.value.some(p=>p.id===projectId))throw Error('独立副本未出现在剪辑库中，请保留当前窗口重试。');
   copy.saved={projectId,studioUrl:studioUrl+'#/editor/'+projectId};return copy.saved;
  }finally{copy.busy=false;}
 }
 async close(){await Promise.all([...this.copies.values()].map(async entry=>{const c=await entry.catch(()=>null);if(c)await this.discard(c.ownerId,c.episodeId,c.session.copyId);}));await Promise.all([...this.libraries].map(root=>closeStandaloneOpenChatCutStudio(root)));this.libraries.clear();}
}
function copyDocument(project:OpenChatCutProject,map:(source:string)=>string):OpenChatCutProject{
 const document=structuredClone(project);
 const visit=(value:unknown)=>{if(Array.isArray(value)){value.forEach(visit);return;}if(!value||typeof value!=='object')return;const record=value as Record<string,unknown>;delete record.originalFilePath;for(const [key,item] of Object.entries(record)){if(key==='src'&&typeof item==='string')record[key]=map(item);else visit(item);}};visit(document);return document;
}
export function completedProjectSources(project:OpenChatCutProject):string[]{
 const sources=new Set<string>();const visit=(value:unknown)=>{if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(key==='src'&&typeof item==='string')sources.add(item);else visit(item);}};visit(project);return[...sources];
}
