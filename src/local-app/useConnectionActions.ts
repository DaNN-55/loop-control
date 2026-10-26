import {useState} from 'react';
import {localConnectionCommand} from './client';
// Shared by the original blueprint capability entry and inline recovery UI.
export function useConnectionActions(refresh:()=>Promise<void>){
 const [error,setError]=useState(''),[pending,setPending]=useState(false);
 async function command<T>(name:string,input:Record<string,unknown>,resumeKey?:string):Promise<T>{
  setPending(true);setError('');try{
   const result=await localConnectionCommand<T>(name,input,resumeKey);
   try{await refresh();}catch{setError('操作已保存；目录刷新失败，请点击刷新重新读取。');}
   if((result as {replayed?:boolean})?.replayed)setError('原操作已经完成，未再次写入秘密；更换认证材料请显式创建新版本。');
   return result;
  }catch{setError('操作未确认完成，请检查授权/绑定并重试原操作；不会自动切换版本。');throw new Error('本地连接操作未完成。');}finally{setPending(false);}
 }
 return {command,error,setError,pending};
}
