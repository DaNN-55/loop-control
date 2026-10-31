import type {ProductionServiceCatalog} from '../connections/serviceCatalog';
import {useEffect,useState} from 'react';
import {ConnectionWorkspace,type ExternalConnection,type ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
import {localRequest} from './client';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useConnectionActions} from './useConnectionActions';
interface ConnectionsRead {serviceCatalog:ProductionServiceCatalog;connections:ExternalConnection[];versions:ExternalConnectionVersion[];capabilities:{secrets:string;verification:string;externalReady:boolean;networkAvailable?:boolean;verificationAvailable?:boolean;verificationByProvider?:Record<string,{available:boolean;detail:string}>}}
export function LocalConnectionsPanel(){
 const [data,setData]=useState<ConnectionsRead|null>(null);
 async function refresh(){setData(await localRequest('connections'));}
 const {command,error,setError,pending}=useConnectionActions(refresh);
 useEffect(()=>{void refresh().catch(()=>setError('连接目录读取失败，请重试。'));},[]);
 return <section aria-label="本地连接" className="dan-ui local-connections-panel">{error&&!data&&<div className="form-error" role="alert"><p>{error}</p><Button color="secondary" size="sm" onPress={()=>void refresh().then(()=>setError('')).catch(()=>setError('连接目录读取失败，请重试。'))}>重新读取连接</Button></div>}{data&&<><ConnectionWorkspace serviceCatalog={data.serviceCatalog} errorMessage={error} verificationByProvider={data.capabilities.verificationByProvider} showHeader={false} statusMessage={data?.capabilities.verificationAvailable?'测试已启用 · 内容生成需单独授权':data?.capabilities.secrets==='keychain'&&data.capabilities.networkAvailable===false?'凭据仅保存到本机 Keychain · 在线验证已锁定':data?.capabilities.externalReady?'已启用 · 每个版本需独立验证':'真实Keychain和在线验证尚未启用；保存或模拟检查不能作为生产就绪证明。'} onRefresh={()=>void refresh().then(()=>setError('')).catch(()=>setError('连接目录读取失败。'))} connections={data.connections} versions={data.versions} secretStorage="本机 Keychain（需授权）" isPending={pending} verificationEnabled={data.capabilities.verificationAvailable??data.capabilities.networkAvailable!==false}
 onCreateConnection={async input=>{try{return (await command<{connection:ExternalConnection}>('create',input)).connection;}catch{return null;}}}
 onRotateConnection={async input=>{try{return (await command<{connection:ExternalConnection}>('rotate',input)).connection;}catch{return null;}}}
 onUpdateConnection={async input=>{await command('update',input);}}
 onRevokeVersion={async versionId=>{try{await command('revoke',{versionId});}catch{/* Visible panel error. */}}}
 onRebindVersion={async(versionId,secret)=>{await command('rebind',{versionId,secret});}}
 onTestConnection={connectionId=>command('verify',{connectionId})}
 /></>}</section>;
}
