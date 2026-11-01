import {useEffect,useRef,useState} from 'react';
import {Dialog,Modal,ModalOverlay} from 'react-aria-components';
import {X} from 'lucide-react';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Input} from '../ui/dan-ui/components/base/input/input';
import {billingProvider,billingProviderLabels,type ConnectionBillingActions,type ConnectionBillingSettings} from './connectionBilling';
import type {ExternalConnection} from './ConnectionWorkspace';
export function ConnectionBillingDialog({connection,onClose,onReadBilling,onSaveBilling,onRefreshBilling,onDisconnectBilling}:ConnectionBillingActions&{connection:ExternalConnection;onClose:()=>void}){
 const [settings,setSettings]=useState<ConnectionBillingSettings|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(true),[operation,setOperation]=useState('');
 const [accessKeyId,setAccessKeyId]=useState(''),[accessKeySecret,setAccessKeySecret]=useState(''),[apiKey,setApiKey]=useState('');
 const [replacing,setReplacing]=useState(false),lock=useRef(false),attempt=useRef<{body:string;key:string}|null>(null);
 const provider=billingProvider(connection.provider),busy=Boolean(operation);
 async function load(){setLoading(true);setError('');try{if(onReadBilling)setSettings(await onReadBilling(connection.id));}catch{setError('账务设置读取失败，请重试。');}finally{setLoading(false);}}
 useEffect(()=>{let active=true;if(onReadBilling)void onReadBilling(connection.id).then(v=>{if(active)setSettings(v);}).catch(()=>{if(active)setError('账务设置读取失败，请重试。');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[connection.id]);
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
   if(!next)throw Error('操作未完成，请重试。');setSettings(next);
   if(action==='save'||action==='disconnect'){clear();setReplacing(false);}
   setMessage(action==='disconnect'?'已断开本机账务关联。':action==='save'?'账务凭据已保存。':'账务数据已更新。');
  }catch(cause){setError(cause instanceof Error?cause.message:'账务操作失败，请重试。');}finally{lock.current=false;setOperation('');}
 }
 if(!provider)return null;
 const editing=!settings?.configured||replacing;
 return <ModalOverlay className="product-ui reference-connections-overlay" isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={open=>{if(!open&&!busy)onClose();}}><Modal className="reference-connections-modal"><Dialog aria-label={`${connection.name} 账务设置`} className="dan-ui connection-workspace reference-connections reference-connections-dialog">
  <header className="reference-connections-dialog-header"><h2>账务设置</h2><Button color="tertiary" size="sm" iconLeading={X} aria-label="关闭账务设置" isDisabled={busy} onPress={onClose}/></header>
  <div className="connection-models-body">
   <strong>{connection.name} · {billingProviderLabels[provider]}</strong>
   <p className="reference-connections-note">用于读取供应商账号的余额与账单，可能包含其他服务或Key的消费。与生成凭据分别保存在本机Keychain。</p>
   {loading?<p role="status">正在读取账务设置…</p>:!settings?<Button color="secondary" size="sm" onPress={()=>void load()}>重新读取</Button>:<>
    {settings.configured?<p className="reference-connections-note">已配置账务凭据 · 不回显密钥</p>:null}
    {editing?<form className="connection-billing-fields" onSubmit={event=>{event.preventDefault();void run('save');}}>
     {provider==='openai'?<Input label="OpenAI Admin API Key" aria-label="OpenAI Admin API Key" type="password" autoComplete="new-password" isRequired isDisabled={busy} value={apiKey} onChange={setApiKey} hint="使用组织Admin Key，普通生成Key无法查询组织账务。"/>:<><Input label="AccessKey ID" aria-label="账务 AccessKey ID" autoComplete="off" isRequired isDisabled={busy} value={accessKeyId} onChange={setAccessKeyId}/><Input label="AccessKey Secret" aria-label="账务 AccessKey Secret" type="password" autoComplete="new-password" isRequired isDisabled={busy} value={accessKeySecret} onChange={setAccessKeySecret}/></>}
     {provider==='aliyun'?<a href="https://help.aliyun.com/zh/user-center/ram-policies-for-billing-management" target="_blank" rel="noreferrer">阿里云账务权限说明</a>:provider==='volcengine'?<a href="https://docs.volcengine.com/docs/billing-center/api-call-instructions?lang=zh" target="_blank" rel="noreferrer">火山引擎账务接入说明</a>:<a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noreferrer">打开OpenAI Admin keys</a>}
     <div className="connection-billing-actions">{replacing?<Button color="secondary" size="sm" isDisabled={busy} onPress={()=>{clear();setReplacing(false);}}>取消更换</Button>:null}<Button color="primary" size="sm" type="submit" isDisabled={busy||(provider==='openai'?!apiKey.trim():!accessKeyId.trim()||!accessKeySecret.trim())} isLoading={operation==='save'} showTextWhileLoading>{operation==='save'?'验证并读取账务…':'验证并保存'}</Button></div>
    </form>:<div className="connection-billing-actions"><Button color="secondary" size="sm" isDisabled={busy} onPress={()=>void run('refresh')} isLoading={operation==='refresh'} showTextWhileLoading>刷新账务</Button><Button color="tertiary" size="sm" isDisabled={busy} onPress={()=>setReplacing(true)}>更换凭据</Button><Button color="tertiary-destructive" size="sm" isDisabled={busy} onPress={()=>void run('disconnect')}>断开账务关联</Button></div>}
    {settings.usage?<section className="connection-billing-summary" aria-label="供应商账务数据">{[settings.usage.remaining,settings.usage.recent].map((item,i)=><div key={i}><span>{item.label}</span><strong>{provider==='openai'&&i===0&&item.text==='控制台查看'?<a className="connection-billing-console-link" href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer" aria-label="在OpenAI控制台查看余额（新窗口）">{item.text}</a>:item.text}</strong><p className="reference-connections-note">{item.detail}</p></div>)}</section>:null}
   </>}
   {message?<p role="status">{message}</p>:null}{error?<p role="alert" className="form-error">{error}</p>:null}
  </div>
 </Dialog></Modal></ModalOverlay>;
}
