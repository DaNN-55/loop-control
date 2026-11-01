import {useEffect,useState,type FormEvent} from 'react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {localCommand} from './client';
import type {GenerationBudgetRead} from './generationBudgets';

export interface BudgetAccount {id:string;name:string}
export function AccountGenerationBudgetSettings({accounts,initialAccountId=''}:{accounts:BudgetAccount[];initialAccountId?:string}){
 const [selected,setSelected]=useState(initialAccountId),[dirty,setDirty]=useState(false),[saving,setSaving]=useState(false);
 const accountId=accounts.some(a=>a.id===selected)?selected:accounts[0]?.id??'';
 useEffect(()=>{if(initialAccountId){setSelected(initialAccountId);setDirty(false);}},[initialAccountId]);
 return <section className="account-generation-budget-settings" aria-label="费用与限额"><header><h2>费用与限额</h2><label>账号<NativeSelect aria-label="预算账号" size="sm" value={accountId} disabled={saving||!accounts.length} onChange={event=>{if(dirty&&!window.confirm('账号预算有未保存修改，确定放弃吗？'))return;setSelected(event.target.value);setDirty(false);}}>{!accounts.length&&<option value="">暂无账号</option>}{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect></label></header>
  {accountId?<AccountBudgetEditor key={accountId} accountId={accountId} onDirty={setDirty} onSaving={setSaving}/>:<p>创建账号后可设置生成预算。</p>}
 </section>;
}
function AccountBudgetEditor({accountId,onDirty,onSaving}:{accountId:string;onDirty:(value:boolean)=>void;onSaving:(value:boolean)=>void}){
 const [value,setValue]=useState<GenerationBudgetRead|null>(null),[trial,setTrial]=useState(''),[total,setTotal]=useState(''),[full,setFull]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[reload,setReload]=useState(0);
 function apply(result:GenerationBudgetRead){setValue(result);setTrial(result.budget?(result.budget.trial_video_limit_cents/100).toFixed(2):'');setTotal(result.budget?(result.budget.total_limit_cents/100).toFixed(2):'');setFull(result.budget?.full_generation_enabled??false);}
 useEffect(()=>{let active=true;setLoading(true);setError('');void localCommand<GenerationBudgetRead>('readGenerationBudget',{accountId},undefined,'account-commands').then(result=>{if(active)apply(result);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'账号预算读取失败。');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[accountId,reload]);
 const validMoney=(amount:string)=>/^\d+(\.\d{1,2})?$/.test(amount)&&Number(amount)>=0.01&&Number(amount)<=1000;
 const valid=validMoney(trial)&&validMoney(total)&&Math.round(Number(total)*100)>=Math.round(Number(trial)*100);
 function edited(){onDirty(true);setSaved(false);}
 async function save(event:FormEvent){event.preventDefault();if(!valid||busy||loading||!value)return;setBusy(true);onSaving(true);setError('');setSaved(false);try{const result=await localCommand<GenerationBudgetRead>('setGenerationBudget',{accountId,trialCents:Math.round(Number(trial)*100),totalCents:Math.round(Number(total)*100),full},undefined,'account-commands');apply(result);onDirty(false);setSaved(true);}catch(cause){setError(cause instanceof Error?cause.message:'账号预算未保存，请重试。');}finally{setBusy(false);onSaving(false);}}
 return <form className="account-budget-editor" aria-label="账号生成预算" onSubmit={event=>void save(event)}>
  <p className="muted-copy">同一账号的生产单共用此限额；不代表 API 余额，保存不会充值或生成。</p>
  {loading?<p role="status">正在读取账号预算…</p>:null}
  {!loading&&!value?<Button size="sm" color="secondary" onPress={()=>setReload(n=>n+1)}>重新读取预算</Button>:null}
  {value&&<><div className="account-budget-readout"><span>已预留 <strong>¥{(value.usedCents/100).toFixed(2)}</strong></span><span>{value.budget?'已设置限额':'尚未设置限额'}</span></div><div className="account-budget-fields"><label>视频试片上限（元）<InputBase aria-label="视频试片上限（元）" size="sm" type="number" min="0.01" max="1000" step="0.01" isDisabled={busy||loading} value={trial} onChange={event=>{setTrial(event.target.value);edited();}}/></label><label>账号总上限（元）<InputBase aria-label="账号总上限（元）" size="sm" type="number" min="0.01" max="1000" step="0.01" isDisabled={busy||loading} value={total} onChange={event=>{setTotal(event.target.value);edited();}}/></label></div><label className="account-budget-full"><input type="checkbox" checked={full} disabled={busy||loading} onChange={event=>{setFull(event.target.checked);edited();}}/>允许视频使用总预算</label><p className="muted-copy">未勾选时，视频受试片上限约束；总上限始终生效。总上限最多 1000 元。</p><footer><Button size="sm" color="primary" type="submit" isDisabled={busy||loading||!valid}>{busy?'保存中…':'保存账号预算'}</Button>{saved&&<span role="status">账号预算已保存</span>}</footer></>}
  {error&&<p role="alert" className="form-error">{error}</p>}
 </form>;
}
