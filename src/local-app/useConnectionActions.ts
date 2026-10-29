import {useState} from 'react';
import {localConnectionCommand} from './client';
// Shared by the original blueprint capability entry and inline recovery UI.
export function useConnectionActions(refresh:()=>Promise<void>){
 const [error,setError]=useState(''),[pending,setPending]=useState(false);
 async function command<T>(name:string,input:Record<string,unknown>,resumeKey?:string):Promise<T>{
  setPending(true);setError('');try{
   const result=await localConnectionCommand<T>(name,input,resumeKey);
   try{await refresh();}catch{setError('操作已保存；目录刷新失败，请点击刷新重新读取。');}
   if((result as {replayed?:boolean})?.replayed)setError('原操作已经完成，未再次写入密钥；更换认证材料请显式创建新版本。');
   return result;
  }catch(cause){const message='操作未确认完成：'+(cause instanceof Error?cause.message:'请检查本机服务后重试。');setError(message);throw new Error(message);}finally{setPending(false);}
 }
 return {command,error,setError,pending};
}
