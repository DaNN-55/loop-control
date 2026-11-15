import {useEffect,useId,useState,type FormEvent} from 'react';
import {businessQualityLabels,businessQualityTiers,type BusinessQualityTier,type ProductionQuality} from '../productionQuality';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {uiText} from '../i18n/ui';
import {localCommand,localRequest} from './client';

/** Owner-selected business tier; selecting an option never changes production. */
export function BusinessQualitySelect({value,onChange,disabled=false}:{value:BusinessQualityTier;onChange:(value:BusinessQualityTier)=>void;disabled?:boolean}){
 const id=useId();
 return <NativeSelect id={id} label={uiText('业务质量档')} name="businessQualityTier" size="sm" disabled={disabled} value={value} onChange={event=>onChange(event.target.value as BusinessQualityTier)}>{businessQualityTiers.map(tier=><option key={tier} value={tier}>{uiText(businessQualityLabels[tier])}</option>)}</NativeSelect>;
}

export function ProductionQualityField({episodeId,readOnly=false}:{episodeId:string;readOnly?:boolean}){
 const [saved,setSaved]=useState<ProductionQuality|null>(null),[draft,setDraft]=useState<BusinessQualityTier>('unspecified');
 const [pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const errorId=useId();
 useEffect(()=>{let current=true;setSaved(null);setError('');setNotice('');
  void localRequest(`production-quality?episodeId=${encodeURIComponent(episodeId)}`).then((value:ProductionQuality)=>{if(current){setSaved(value);setDraft(value.tier);}}).catch(error=>{if(current)setError(error instanceof Error?error.message:'业务质量档读取失败，请重新打开生产单。');});
  return()=>{current=false;};
 },[episodeId]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(timer);},[notice]);
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!saved||pending||readOnly||draft===saved.tier)return;
  setPending(true);setError('');setNotice('');
  try{const value=await localCommand<Omit<ProductionQuality,'enabled'>>('setProductionQuality',{episodeId,tier:draft,expectedRevision:saved.revision},undefined,'episode-commands');setSaved({enabled:true,...value});setDraft(value.tier);setNotice('业务质量档已保存。');}
  catch(error){setError(error instanceof Error?error.message:'业务质量档未保存，请重试。');}
  finally{setPending(false);}
 }
 if(saved?.enabled===false)return null;
 return <form className="workspace-actions" aria-label={uiText('业务质量档')} aria-busy={pending} aria-describedby={error?errorId:undefined} onSubmit={event=>void save(event)}>
  <span className="field-label">{uiText('业务质量档')}</span>
  <BusinessQualitySelect value={draft} onChange={value=>{setDraft(value);setError('');setNotice('');}} disabled={pending||readOnly||!saved}/>
  {saved&&!readOnly&&draft!==saved.tier?<Button type="submit" size="sm" color="secondary" isDisabled={pending}>{uiText(pending?'正在保存…':'保存质量档')}</Button>:null}
  {error?<span id={errorId} role="alert" className="form-error">{uiText(error)}</span>:null}
  {notice?<span role="status">{uiText(notice)}</span>:null}
 </form>;
}
