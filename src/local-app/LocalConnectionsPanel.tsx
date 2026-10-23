import {useEffect,useState} from 'react';
import {ConnectionWorkspace,type ExternalConnection,type ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
import {localRequest,localConnectionCommand} from './client';
interface ConnectionsRead {connections:ExternalConnection[];versions:ExternalConnectionVersion[];pending:{idempotency_key:string;metadata:Record<string,string>}[];capabilities:{secrets:string;verification:string;externalReady:boolean}}
export function LocalConnectionsPanel(){
 const [data,setData]=useState<ConnectionsRead|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[drafts,setDrafts]=useState<Record<string,string>>({});
 async function refresh(){setData(await localRequest('connections'));}
 useEffect(()=>{void refresh().catch(()=>setError('连接目录读取失败，请重试。'));},[]);
 async function command<T>(command:string,input:Record<string,unknown>,resumeKey?:string):Promise<T>{
  setPending(true);setError('');try{
   const result=await localConnectionCommand<T>(command,input,resumeKey);
   try{await refresh();}catch{setError('操作已保存；目录刷新失败，请点击刷新重新读取。');}
   if((result as {replayed?:boolean})?.replayed)setError('原操作已经完成，未再次写入秘密；更换认证材料请显式创建新版本。');
   return result;
  }catch{setError('操作未确认完成，请检查授权/绑定并重试原操作；不会自动切换版本。');throw new Error('本地连接操作未完成。');}finally{setPending(false);}
 }
 return <section aria-label="本地连接"><p role="status">{data?.capabilities.externalReady?'本地连接管理已启用，仍需逐版本验证。':'真实Keychain和在线验证尚未启用；保存或模拟检查不能作为生产就绪证明。'}</p>{error&&<p role="alert">{error}</p>}<button onClick={()=>void refresh().then(()=>setError('')).catch(()=>setError('连接目录读取失败。'))}>刷新连接</button>{data&&<><ConnectionWorkspace connections={data.connections} versions={data.versions} secretStorage="本机 Keychain（需授权）" isPending={pending}
 onCreateConnection={async input=>{try{return (await command<{connection:ExternalConnection}>('create',input)).connection;}catch{return null;}}}
 onRotateConnection={async input=>{try{return (await command<{connection:ExternalConnection}>('rotate',input)).connection;}catch{return null;}}}
 onUpdateConnection={async input=>{try{await command('update',input);}catch{/* Visible panel error. */}}}
 onRevokeVersion={async versionId=>{try{await command('revoke',{versionId});}catch{/* Visible panel error. */}}}
 onRebindVersion={async(versionId,secret)=>{await command('rebind',{versionId,secret});}}
 onTestConnection={async connectionId=>{try{await command('verify',{connectionId});}catch{/* Saved creation remains successful. */}}}
 />{data.pending.length>0&&<section aria-label="未完成连接操作"><h3>未完成连接操作</h3><p>只有操作标识和元数据保存在本机；重新输入原认证材料以安全重试。</p>{data.pending.map(intent=><fieldset key={intent.idempotency_key}><legend>{intent.metadata.command} · {intent.metadata.name??intent.metadata.connectionId??intent.metadata.versionId}</legend><input type="password" autoComplete="off" aria-label={`恢复操作 ${intent.idempotency_key}`} value={drafts[intent.idempotency_key]??''} onChange={event=>setDrafts(current=>({...current,[intent.idempotency_key]:event.target.value}))}/><button disabled={pending||!drafts[intent.idempotency_key]} onClick={()=>{const {command:name,...metadata}=intent.metadata;void command(name,{...metadata,secret:drafts[intent.idempotency_key]},intent.idempotency_key).then(()=>setDrafts(current=>({...current,[intent.idempotency_key]:''}))).catch(()=>{});}}>重试原操作</button></fieldset>)}</section>}</>}</section>;
}
