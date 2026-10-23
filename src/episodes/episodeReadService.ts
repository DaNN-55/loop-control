export interface EpisodeReadChanges<T> {hashes:Record<string,string>;sections:Partial<T>;patches?:Record<string,{rows:Array<{id:string}>;ids:string[]}>}
export function createEpisodeReader<T>(fetchChanges:(episodeId:string,known:Record<string,string>,scope:string)=>Promise<EpisodeReadChanges<T>>) {
 let cached:{id:string;scope:string;data:T;hashes:Record<string,string>}|undefined;
 let currentScope="";
 const active=new Map<string,Promise<T>>();
 return function load(id:string,scope="",fresh=false):Promise<T>{
  if(currentScope!==scope){currentScope=scope;cached=undefined;}
  const key=scope+"\0"+id;
  const pending=active.get(key);if(pending)return fresh?pending.catch(()=>undefined).then(()=>load(id,scope)):pending;
  const previous=cached?.id===id&&cached.scope===scope?cached:undefined;
  const request=fetchChanges(id,previous?.hashes??{},scope).then(changes=>{
   const data={...previous?.data,...changes.sections} as T;
   for(const [section,patch] of Object.entries(changes.patches??{})){
    const record=data as Record<string,unknown>;const previousRows=record[section] as Array<{id:string}>|undefined;
    const byId=new Map((previousRows??[]).map(row=>[row.id,row]));for(const row of patch.rows)byId.set(row.id,row);
    record[section]=patch.ids.map(key=>{const row=byId.get(key);if(!row)throw Error("生产单增量缺少记录，请重新读取。");return row;});
   }
   if(currentScope===scope)cached={id,scope,data,hashes:changes.hashes};return data;
  }).catch(error=>{if(cached?.id===id&&cached.scope===scope)cached=undefined;throw error;}).finally(()=>{active.delete(key);});
  active.set(key,request);return request;
 };
}
