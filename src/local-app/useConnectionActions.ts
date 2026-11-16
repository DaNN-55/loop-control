import {useEffect,useRef,useState} from 'react';
import {localConnectionCommand} from './client';
// The committed response owns the mutation; directory reads update separately.
export function useConnectionActions(refresh:()=>Promise<void>,ownerScope=''){
 const [error,setError]=useState(''),[pending,setPending]=useState(false);
 const mounted=useRef(false),generation=useRef(0),scope=useRef(ownerScope);scope.current=ownerScope;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useEffect(()=>{generation.current++;setError('');setPending(false);},[ownerScope]);
 async function command<T>(name:string,input:Record<string,unknown>,resumeKey?:string):Promise<T>{
  const request=++generation.current,owner=scope.current,current=()=>mounted.current&&request===generation.current&&owner===scope.current;
  setPending(true);setError('');try{
   const result=await localConnectionCommand<T>(name,input,resumeKey);
   if(current()){
    const replayed=(result as {replayed?:boolean})?.replayed,notice='原操作已经完成，未再次写入密钥；更换认证材料请显式创建新版本。';
    void Promise.resolve().then(()=>{if(current())return refresh();}).catch(()=>{if(current())setError((replayed?notice:'操作已保存；')+'目录刷新失败，请点击刷新重新读取。');});
    if(replayed)setError(notice);
   }
   return result;
  }catch(cause){const message='操作未确认完成：'+(cause instanceof Error?cause.message:'请检查本机服务后重试。');if(current())setError(message);throw new Error(message);}finally{if(current())setPending(false);}
 }
 return {command,error,setError,pending};
}
