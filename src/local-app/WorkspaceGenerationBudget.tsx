import {useEffect,useState} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {localRequest} from './client';
import type {GenerationBudgetRead} from './generationBudgets';

/** Generation controls display the account limit; editing lives in connection settings. */
export function WorkspaceGenerationBudget({episodeId,disabled=false,refreshKey,kind='video',shotId,targetItemId}:{episodeId?:string;disabled?:boolean;refreshKey?:unknown;kind?:'image'|'video';shotId?:string;targetItemId?:string}){
 const [value,setValue]=useState<GenerationBudgetRead|null>(null),[failed,setFailed]=useState(false),[reading,setReading]=useState(!!episodeId);
 useEffect(()=>{
  let current=true;
  async function read(){if(!episodeId)return;setReading(true);try{const result=await localRequest('wan-budget?'+new URLSearchParams({episode:episodeId}));if(current){setValue(result);setFailed(false);}}catch{if(current){setValue(null);setFailed(true);}}finally{if(current)setReading(false);}}
  setValue(null);void read();window.addEventListener('focus',read);return()=>{current=false;window.removeEventListener('focus',read);};
 },[episodeId,refreshKey]);
 const budget=value?.budget,money=(cents:number)=>(cents/100).toFixed(2);
 return <div className="workspace-budget-status" aria-label="账号预算状态"><span role="status">{reading?'正在读取账号预算…':failed?'账号预算暂不可用':budget?`账号预算 ¥${money(budget.total_limit_cents)} · 已预留 ¥${money(value.usedCents)}${kind==='video'&&!budget.full_generation_enabled?` · 试片上限 ¥${money(budget.trial_video_limit_cents)}`:''}`:episodeId?'尚未设置账号预算':'在连接设置中管理账号预算'}</span><Button size="sm" color="tertiary" isDisabled={disabled} onPress={()=>window.dispatchEvent(new CustomEvent('open-external-connections',{detail:{section:'budgets',accountId:value?.accountId,episodeId,shotId,targetItemId}}))}>调整预算</Button></div>;
}
