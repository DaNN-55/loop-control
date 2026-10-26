import {useEffect,useState} from 'react';
import {ConnectionWorkspace,type ExternalConnection,type ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
import {localRequest} from './client';
import {useConnectionActions} from './useConnectionActions';
interface ConnectionsRead {connections:ExternalConnection[];versions:ExternalConnectionVersion[];pending:{idempotency_key:string;metadata:Record<string,string>}[];capabilities:{secrets:string;verification:string;externalReady:boolean;networkAvailable?:boolean}}
export function LocalConnectionsPanel(){
 const [data,setData]=useState<ConnectionsRead|null>(null),[drafts,setDrafts]=useState<Record<string,string>>({});
 async function refresh(){setData(await localRequest('connections'));}
 const {command,error,setError,pending}=useConnectionActions(refresh);
 useEffect(()=>{void refresh().catch(()=>setError('连接目录读取失败，请重试。'));},[]);
 return <section aria-label="本地连接"><p role="status">{data?.capabilities.secrets==='keychain'&&data.capabilities.networkAvailable===false?'凭据仅保存到本机 Keychain；在线验证已锁定，当前不会发出 Provider 请求。':data?.capabilities.externalReady?'本地连接管理已启用，仍需逐版本验证。':'真实Keychain和在线验证尚未启用；保存或模拟检查不能作为生产就绪证明。'}</p>{error&&<p role="alert">{error}</p>}<button onClick={()=>void refresh().then(()=>setError('')).catch(()=>setError('连接目录读取失败。'))}>刷新连接</button>{data&&<><ConnectionWorkspace connections={data.connections} versions={data.versions} secretStorage="本机 Keychain（需授权）" isPending={pending} verificationEnabled={data.capabilities.networkAvailable!==false}
 onCreateConnection={async input=>{try{return (await command<{connection:ExternalConnection}>('create',input)).connection;}catch{return null;}}}
 onRotateConnection={async input=>{try{return (await command<{connection:ExternalConnection}>('rotate',input)).connection;}catch{return null;}}}
 onUpdateConnection={async input=>{try{await command('update',input);}catch{/* Visible panel error. */}}}
 onRevokeVersion={async versionId=>{try{await command('revoke',{versionId});}catch{/* Visible panel error. */}}}
 onRebindVersion={async(versionId,secret)=>{await command('rebind',{versionId,secret});}}
 onTestConnection={async connectionId=>{try{await command('verify',{connectionId});}catch{/* Saved creation remains successful. */}}}
 />{data.pending.length>0&&<section aria-label="未完成连接操作"><h3>未完成连接操作</h3><p>只有操作标识和元数据保存在本机；重新输入原认证材料以安全重试。</p>{data.pending.map(intent=><fieldset key={intent.idempotency_key}><legend>{intent.metadata.command} · {intent.metadata.name??intent.metadata.connectionId??intent.metadata.versionId}</legend><input type="password" autoComplete="off" aria-label={`恢复操作 ${intent.idempotency_key}`} value={drafts[intent.idempotency_key]??''} onChange={event=>setDrafts(current=>({...current,[intent.idempotency_key]:event.target.value}))}/><button disabled={pending||!drafts[intent.idempotency_key]} onClick={()=>{const {command:name,...metadata}=intent.metadata;void command(name,{...metadata,secret:drafts[intent.idempotency_key]},intent.idempotency_key).then(()=>setDrafts(current=>({...current,[intent.idempotency_key]:''}))).catch(()=>{});}}>重试原操作</button></fieldset>)}</section>}</>}</section>;
}
