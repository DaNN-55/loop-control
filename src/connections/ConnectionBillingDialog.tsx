import {uiText} from '../i18n/ui';
import {useEffect,useRef,useState} from 'react';
import {Dialog,Modal,ModalOverlay} from 'react-aria-components';
import {X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {Input} from '../ui/dan-ui/components/base/input/input';
import {billingProvider,billingProviderLabels,type ConnectionBillingActions,type ConnectionBillingSettings} from './connectionBilling';
import type {ExternalConnection} from './ConnectionWorkspace';
import {connectionUsagePlaceholder,type ConnectionUsageSummary} from './connectionUsage';
import {ConnectionDraftLeaveDialog} from './ConnectionDraftLeaveDialog';
export function ConnectionBillingDialog({embedded=false,connection,onClose,onReadBilling,onReadUsage,onSaveBilling,onRefreshBilling,onDisconnectBilling,onStateChange}:ConnectionBillingActions&{embedded?:boolean;connection:ExternalConnection;onClose:()=>void;onReadUsage?:(connectionId:string)=>Promise<ConnectionUsageSummary>;onStateChange?:(state:{busy:boolean;dirty:boolean})=>void}){
 const [settings,setSettings]=useState<ConnectionBillingSettings|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(true),[operation,setOperation]=useState('');
 const [accessKeyId,setAccessKeyId]=useState(''),[accessKeySecret,setAccessKeySecret]=useState(''),[apiKey,setApiKey]=useState('');
 const [replacing,setReplacing]=useState(false),lock=useRef(false),attempt=useRef<{body:string;key:string}|null>(null);
 const provider=billingProvider(connection.provider),busy=Boolean(operation);
 const dirty=Boolean(accessKeyId||accessKeySecret||apiKey),[leavePrompt,setLeavePrompt]=useState(false);
 const stateChange=useRef(onStateChange);stateChange.current=onStateChange;
 useEffect(()=>{stateChange.current?.({busy,dirty});},[busy,dirty]);
 useEffect(()=>()=>{stateChange.current?.({busy:false,dirty:false});},[]);
 function requestClose(){if(busy)return;if(dirty)setLeavePrompt(true);else onClose();}
 const canConfigure=Boolean(provider&&onReadBilling);
 const [usage,setUsage]=useState<ConnectionUsageSummary|null>(null);
 const [usageLoading,setUsageLoading]=useState(Boolean(onReadUsage)),[usageError,setUsageError]=useState(false);
 const [usageAttempt,setUsageAttempt]=useState(0);
 const usageEpoch=useRef(0);
 async function load(){setLoading(true);setError('');try{if(onReadBilling)setSettings(await onReadBilling(connection.id));}catch{setError(uiText("账务设置读取失败，请重试。"));}finally{setLoading(false);}}
 useEffect(()=>{let active=true;if(provider&&onReadBilling)void onReadBilling(connection.id).then(v=>{if(active)setSettings(v);}).catch(()=>{if(active)setError(uiText("账务设置读取失败，请重试。"));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[connection.id]);
 useEffect(()=>{
  if(!onReadUsage)return;
  let active=true;
  const epoch=usageEpoch.current;
  void onReadUsage(connection.id).then(value=>{if(active&&epoch===usageEpoch.current)setUsage(value);})
   .catch(()=>{if(active&&epoch===usageEpoch.current)setUsageError(true);}).finally(()=>{if(active)setUsageLoading(false);});
  return()=>{active=false;};
 },[connection.id,usageAttempt]);
 function clear(){setAccessKeyId('');setAccessKeySecret('');setApiKey('');attempt.current=null;}
 async function run(action:'save'|'refresh'|'disconnect'){
  if(lock.current||!settings)return;lock.current=true;setOperation(action);setError('');setMessage('');
  try{
   let next:ConnectionBillingSettings|undefined;
   if(action==='save'){
    const credential=JSON.stringify(provider==='openai'?{apiKey:apiKey.trim()}:{accessKeyId:accessKeyId.trim(),accessKeySecret:accessKeySecret.trim()}),body=JSON.stringify({connectionId:connection.id,revision:settings.revision,credential});
    if(attempt.current?.body!==body)attempt.current={body,key:crypto.randomUUID()};
    next=await onSaveBilling?.(JSON.parse(body),attempt.current.key);
   }else if(action==='refresh')next=await onRefreshBilling?.({connectionId:connection.id,revision:settings.revision});
   else next=await onDisconnectBilling?.({connectionId:connection.id,revision:settings.revision});
   if(!next)throw Error(uiText("操作未完成，请重试。"));setSettings(next);
   usageEpoch.current++;
   setUsage(next.usage??connectionUsagePlaceholder(connection.provider));
   setUsageError(false);
   if(action==='save'||action==='disconnect'){clear();setReplacing(false);}
   setMessage(action==='disconnect'?uiText("已断开本机账务关联。"):action==='save'?uiText("账务凭据已保存。"):uiText("账务数据已更新。"));
  }catch(cause){setError(cause instanceof Error?cause.message:uiText("账务操作失败，请重试。"));}finally{lock.current=false;setOperation('');}
 }
 if(!canConfigure&&!onReadUsage)return null;
 const editing=!settings?.configured||replacing;
 const displayUsage=settings?.usage??usage??(provider==='openai'?connectionUsagePlaceholder(connection.provider):null);
 const metrics=displayUsage?[displayUsage.remaining,displayUsage.recent]:[];
 const metricNotes=metrics.filter(item=>item.status!=='unavailable'&&item.status!=='loading');
 const content=<>{!embedded&&<>  <header className="reference-connections-dialog-header"><h2>{uiText("账务设置")}</h2><Button color="tertiary" size="sm" iconLeading={X} aria-label={uiText("关闭账务设置")} isDisabled={busy} onPress={requestClose}/></header></>}
  <div className="connection-models-body">
   <strong hidden={embedded}>{connection.name}{provider?` · ${billingProviderLabels[provider]}`:''}</strong>
   {canConfigure&&(loading?<p role="status">{uiText("正在读取账务设置…")}</p>:!settings?<Button color="secondary" size="sm" onPress={()=>void load()}>{uiText("重试读取设置")}</Button>:<>
    {settings.configured&&!replacing?<p className="reference-connections-note">{uiText("已配置账务凭据")}</p>:null}
    {editing?<form className="connection-billing-fields" onSubmit={event=>{event.preventDefault();void run('save');}}>
     {provider==='openai'?<Input label="OpenAI Admin API Key" aria-label="OpenAI Admin API Key" type="password" autoComplete="new-password" isRequired isDisabled={busy} value={apiKey} onChange={setApiKey} hint={uiText("账务查询需要组织 Admin Key。")}/>:<><Input label="AccessKey ID" aria-label={uiText("账务 AccessKey ID")} autoComplete="off" isRequired isDisabled={busy} value={accessKeyId} onChange={setAccessKeyId}/><Input label="AccessKey Secret" aria-label={uiText("账务 AccessKey Secret")} type="password" autoComplete="new-password" isRequired isDisabled={busy} value={accessKeySecret} onChange={setAccessKeySecret}/></>}
     {provider==='aliyun'?<a href="https://help.aliyun.com/zh/user-center/ram-policies-for-billing-management" target="_blank" rel="noreferrer">{uiText("阿里云账务权限")}</a>:provider==='volcengine'?<a href="https://docs.volcengine.com/docs/billing-center/api-call-instructions?lang=zh" target="_blank" rel="noreferrer">{uiText("火山引擎账务权限")}</a>:<a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noreferrer">{uiText("管理 OpenAI Admin Key")}</a>}
     {!embedded&&<div className="connection-billing-actions">{replacing?<Button color="secondary" size="sm" isDisabled={busy} onPress={()=>{clear();setReplacing(false);}}>{uiText("取消更换")}</Button>:null}<Button color="primary" size="sm" type="submit" isDisabled={busy||(provider==='openai'?!apiKey.trim():!accessKeyId.trim()||!accessKeySecret.trim())} isLoading={operation==='save'} showTextWhileLoading>{operation==='save'?uiText("验证并读取账务…"):uiText("验证并保存")}</Button></div>}
    </form>:<div className="connection-billing-actions"><Button color="secondary" size="sm" isDisabled={busy} onPress={()=>void run('refresh')} title={uiText("向供应商重新查询账务")} isLoading={operation==='refresh'} showTextWhileLoading>{uiText("刷新账务")}</Button><Button color="tertiary" size="sm" isDisabled={busy} onPress={()=>setReplacing(true)}>{uiText("更换凭据")}</Button><Button color="tertiary-destructive" size="sm" isDisabled={busy} aria-label={uiText("断开「{value0}」的账务关联",{value0:connection.name})} title={uiText("断开账务凭据，生成连接仍可使用")} onPress={()=>void run('disconnect')}>{uiText("断开账务关联")}</Button></div>}
   </>)}
   {usageLoading&&!displayUsage&&<p role="status">{uiText("正在读取账务数据…")}</p>}
   {displayUsage&&<section className="connection-billing-summary" aria-label={uiText("供应商账务数据")}>{metrics.map((item,i)=><div key={i}>
    <span>{item.label==='组织7天'?uiText("组织近 7 天"):uiText(item.label)}</span>
    <strong>{provider==='openai'&&i===0&&item.status==='unsupported'?<a className="connection-billing-console-link" href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer" aria-label={uiText("在 OpenAI 控制台查看余额（新窗口）")}>{uiText("控制台查看")}</a>:uiText(item.text)}</strong>
    {item.status==='unavailable'&&<p className="reference-connections-note">{uiText(item.detail)}</p>}
   </div>)}</section>}
   {(canConfigure||metricNotes.length>0)&&<Disclosure label={uiText("统计说明")}>
    {canConfigure&&<p className="reference-connections-note">{uiText("账务按供应商账号统计，可能包含其他服务或 Key 的费用。账务凭据单独保存在本机 Keychain。")}</p>}
    {metricNotes.map(item=><p className="reference-connections-note" key={item.label}>{uiText(item.detail)}</p>)}
   </Disclosure>}
   {usageError&&<div><p role="alert">{uiText("账务数据读取失败。")}</p><Button color="secondary" size="sm" isDisabled={busy} onPress={()=>{setUsageError(false);setUsageLoading(true);setUsageAttempt(value=>value+1);}}>{uiText("重试读取数据")}</Button></div>}
   {message?<p role="status">{message}</p>:null}{error?<p role="alert" className="form-error">{error}</p>:null}
  </div>
  {embedded&&<footer className="reference-connections-dialog-footer"><Button size="sm" color="secondary" isDisabled={busy||!dirty&&!replacing} onPress={()=>{clear();setReplacing(false);setError('');}}>{uiText("取消")}</Button><Button size="sm" color="primary" isLoading={operation==='save'} showTextWhileLoading isDisabled={busy||!settings||!editing||(provider==='openai'?!apiKey.trim():!accessKeyId.trim()||!accessKeySecret.trim())} onPress={()=>void run('save')}>{uiText("保存")}</Button></footer>}</>;
 return <>{embedded?<section className="connection-embedded-pane" aria-label={uiText("账务设置")}>{content}</section>:<><ModalOverlay className="product-ui reference-connections-overlay" isOpen isDismissable={!busy&&!leavePrompt} isKeyboardDismissDisabled={busy||leavePrompt} onOpenChange={open=>{if(!open)requestClose();}}><Modal className="reference-connections-modal"><Dialog aria-label={uiText("{value0} 账务设置",{value0:connection.name})} className="dan-ui connection-workspace reference-connections reference-connections-dialog">
{content}</Dialog></Modal></ModalOverlay></>}{leavePrompt&&<ConnectionDraftLeaveDialog hasSecret onContinue={()=>setLeavePrompt(false)} onDiscard={()=>{clear();onClose();}}/>}</>;
}
