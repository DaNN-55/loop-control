import {useEffect,useState} from 'react';
import type {ScriptStudioPlan} from '../scriptStudio';
import {localRequest} from './client';
export interface ScriptStudioSource {sourceText:string;targetDuration:number|null;plan?:ScriptStudioPlan}
/** Read the retained source before mounting a draft against its immutable baseline. */
export function useScriptStudioSource(episodeId:string,revisionId:string|null,script:string){
 const key=JSON.stringify([episodeId,revisionId,script]),[retry,setRetry]=useState(0);
 const [state,setState]=useState<{key:string;value:ScriptStudioSource;error:string;loaded:boolean}>(()=>({key,value:{sourceText:script,targetDuration:null},error:'',loaded:!revisionId}));
 useEffect(()=>{
  if(!revisionId){setState({key,value:{sourceText:script,targetDuration:null},error:'',loaded:true});return;}
  let active=true;const controller=new AbortController();
  setState(previous=>previous.key===key?{...previous,error:'',loaded:false}:{key,value:{sourceText:script,targetDuration:null},error:'',loaded:false});
  void localRequest('script-studio?episodeId='+encodeURIComponent(episodeId)+'&scriptRevisionId='+encodeURIComponent(revisionId),{signal:controller.signal}).then((value:ScriptStudioSource)=>{if(active){if(typeof value?.sourceText!=='string'||value.targetDuration!==null&&typeof value.targetDuration!=='number')throw Error('主脚本原文读取结果无效，请重新读取。');setState({key,value,error:'',loaded:true});}}).catch(cause=>{if(active)setState(previous=>({...previous,key,error:cause instanceof Error?cause.message:'原文读取失败，请重试。',loaded:false}));});
  return()=>{active=false;controller.abort();};
 },[key,retry]);
 return{value:state.key===key?state.value:{sourceText:script,targetDuration:null},loading:state.key!==key||!state.loaded,error:state.key===key?state.error:'',retry:()=>setRetry(n=>n+1)};
}
