import type {UploadNotice} from './WorkspaceUploadFeedback';

export interface WorkspaceImportedMaterial {id:string;material_type:string;source_path:string;storage_path:string;is_main_script?:boolean;material_purpose?:string;mime_type?:string;file_size?:number|string}
export interface WorkspaceUploadEntry {
 id:number;name:string;file?:File;status:'pending'|'running'|'succeeded'|'failed';material?:WorkspaceImportedMaterial;error?:string;
}
interface Snapshot<Entry> {rows:Entry[];running:boolean;retainedMaterials:WorkspaceImportedMaterial[];notice?:UploadNotice}
interface Executor<Entry> {
 active:()=>boolean;importFile:(row:Entry)=>Promise<WorkspaceImportedMaterial>;
 complete?:(row:Entry,material:WorkspaceImportedMaterial)=>Promise<void>;
 onImported?:(material:WorkspaceImportedMaterial)=>void;
 paused:(row:Entry,imported:boolean)=>string;
 failed:(row:Entry,imported:boolean,message:string)=>string;
 summary?:(completed:Entry[],unfinished:Entry[])=>string;
}
export interface WorkspaceUploadSession<Entry extends WorkspaceUploadEntry> {
 read:()=>Snapshot<Entry>;
 subscribe:(listener:()=>void)=>()=>void;
 update:(change:(value:Snapshot<Entry>)=>Snapshot<Entry>)=>void;
 enqueue:(entries:Omit<Entry,'id'|'status'>[])=>Entry[];
 report:(message:string,failed?:boolean)=>void;
 abandon:()=>void;
 run:(entries:Entry[],executor:Executor<Entry>)=>Promise<void>;
}
let entryId=0,noticeId=0;
/** One typed registry per upload entry shape. Keys include their owning browser scope. */
export function workspaceUploadSessions<Entry extends WorkspaceUploadEntry>(){
 const sessions=new Map<string,WorkspaceUploadSession<Entry>>();
 return (key:string)=>{
  let session=sessions.get(key);
  if(!session){session=createWorkspaceUploadSession<Entry>();sessions.set(key,session);}
  return session;
 };
}
/** Unfinished files and import receipts survive panel closure within this browser page. */
export function createWorkspaceUploadSession<Entry extends WorkspaceUploadEntry>():WorkspaceUploadSession<Entry>{
 let value:Snapshot<Entry>={rows:[],running:false,retainedMaterials:[]};const listeners=new Set<()=>void>();
 function update(change:(snapshot:Snapshot<Entry>)=>Snapshot<Entry>){value=change(value);for(const listener of listeners)listener();}
 function patch(id:number,change:Partial<Entry>){update(snapshot=>({...snapshot,rows:snapshot.rows.map(row=>row.id===id?{...row,...change}:row)}));}
 function report(message:string,failed=true){update(snapshot=>({...snapshot,notice:{id:++noticeId,message,failed,expiresAt:Date.now()+5000}}));}
 const session:WorkspaceUploadSession<Entry>={read:()=>value,subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},update,report,
  enqueue(entries){const rows=entries.map(entry=>({...entry,id:++entryId,status:'pending'}) as Entry);update(snapshot=>({...snapshot,rows:[...snapshot.rows,...rows]}));return rows;},
  abandon(){
   if(value.running)return;
   const unfinished=value.rows.filter(row=>row.status!=='succeeded');
   if(!unfinished.length)return;
   const materials=[...value.retainedMaterials,...unfinished.flatMap(row=>row.material?[row.material]:[])];
   update(snapshot=>({...snapshot,rows:snapshot.rows.filter(row=>row.status==='succeeded'),retainedMaterials:materials.filter((material,index)=>materials.findIndex(known=>known.id===material.id)===index)}));
   report(`已放弃 ${unfinished.length} 项未完成上传${materials.length?'，已导入素材已保留':''}。`,false);
  },
  async run(entries,executor){
   entries=entries.filter(entry=>value.rows.some(row=>row.id===entry.id&&row.status!=='succeeded'));
   if(value.running||!entries.length)return;
   update(snapshot=>({...snapshot,running:true}));
   try{
    for(const row of entries){
     if(!executor.active())break;
     patch(row.id,{status:'running',error:undefined} as Partial<Entry>);
     let material=row.material;
     try{
      if(!material){
       material=await executor.importFile(row);
       patch(row.id,{material,file:undefined} as Partial<Entry>);
       if(executor.active())executor.onImported?.(material);
      }
      if(executor.complete){
       if(!executor.active()){patch(row.id,{status:'pending',error:executor.paused(row,true)} as Partial<Entry>);break;}
       await executor.complete(row,material);
      }
      patch(row.id,{status:'succeeded',file:undefined,error:undefined} as Partial<Entry>);
     }catch(cause){
      const paused=cause instanceof Error&&cause.name==='AbortError';
      patch(row.id,{status:paused?'pending':'failed',error:paused?executor.paused(row,!!material):executor.failed(row,!!material,cause instanceof Error?cause.message:'上传未完成，请重试。')} as Partial<Entry>);
     }
    }
   }finally{
    const completed=value.rows.filter(row=>entries.some(entry=>entry.id===row.id)),unfinished=completed.filter(row=>row.status!=='succeeded');
    const message=executor.summary?.(completed,unfinished)??(unfinished.length===1?`${unfinished[0].name}：${unfinished[0].error??'上传未完成，请重试。'}`:unfinished.length?`${unfinished.length} 个文件未完成，请查看失败详情并重试。`:`已添加 ${completed.length} 个文件。`);
    update(snapshot=>({...snapshot,running:false,notice:{id:++noticeId,message,failed:unfinished.length>0,expiresAt:Date.now()+5000}}));
   }
  },
 };
 return session;
}
export async function readWorkspaceUploadFile(file:File){
 return new Promise<string>((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result).split(',')[1]);
  reader.onerror=()=>reject(Error('素材读取失败。'));
  reader.onabort=()=>reject(Object.assign(Error('素材读取已取消。'),{name:'AbortError'}));
  reader.readAsDataURL(file);
 });
}
