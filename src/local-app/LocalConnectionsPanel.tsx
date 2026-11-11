import {useCatalogPanelNavigation} from './catalogNavigation';
import type {ProductionServiceCatalog} from '../connections/serviceCatalog';
import {useEffect,useRef,useState} from 'react';
import {ConnectionWorkspace,type ExternalConnection,type ExternalConnectionVersion} from '../connections/ConnectionWorkspace';
import {localCommand,localRequest,localBillingCommand} from './client';
import type {ConnectionBillingSettings} from '../connections/connectionBilling';
import {connectionUsagePlaceholder} from '../connections/connectionUsage';
import type {ConnectionModelSettings} from '../connections/connectionModels';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {useConnectionActions} from './useConnectionActions';
import {connectionUsageSupported,type ConnectionUsageRead,type ConnectionUsageSummary} from '../connections/connectionUsage';
interface ConnectionsRead {serviceCatalog:ProductionServiceCatalog;connections:ExternalConnection[];versions:ExternalConnectionVersion[];capabilities:{billing?:boolean;secrets:string;verification:string;externalReady:boolean;networkAvailable?:boolean;verificationAvailable?:boolean;verificationByProvider?:Record<string,{available:boolean;detail:string}>}}
export function LocalConnectionsPanel({inlineBilling=false,settingsLayout=false}:{inlineBilling?:boolean;settingsLayout?:boolean}={}){
 const navigation=useCatalogPanelNavigation('connections');
 const [data,setData]=useState<ConnectionsRead|null>(null);
 const reading=useRef({active:false,sequence:0,controller:null as AbortController|null});
 const savedModels=useRef(false);
 const billingEpoch=useRef<Record<string,number>>({});
 const beginBilling=(id:string)=>{billingEpoch.current[id]=(billingEpoch.current[id]??0)+1;};
 const [usage,setUsage]=useState<Record<string,ConnectionUsageSummary>>({});
 const usageVersions=settingsLayout?'':data?.connections.filter(c=>connectionUsageSupported(c.provider)).map(c=>c.id+':'+c.current_version_id).join('|')??'';
 useEffect(()=>{
  if(settingsLayout)return;
  let active=true;
  for(const connection of data?.connections.filter(c=>connectionUsageSupported(c.provider))??[]){
   const epoch=billingEpoch.current[connection.id]??0;
   void localRequest('connection-usage?connectionId='+connection.id).then((result:ConnectionUsageRead)=>{if(active&&epoch===(billingEpoch.current[connection.id]??0)&&result.versionId===connection.current_version_id)setUsage(current=>({...current,[result.versionId]:result.usage}));}).catch(()=>{if(active&&epoch===(billingEpoch.current[connection.id]??0)&&connection.current_version_id)setUsage(current=>({...current,[connection.current_version_id!]:{remaining:{label:'余量',text:'读取失败',detail:'未能读取供应商数据，请稍后重新打开连接页。',status:'unavailable'},recent:{label:'近7天',text:'读取失败',detail:'未能读取供应商数据，请稍后重新打开连接页。',status:'unavailable'},updatedAt:null}}));});
  }
  return()=>{active=false;};
 },[usageVersions,settingsLayout]);
 function applyBilling(result:ConnectionBillingSettings){
  const connection=data?.connections.find(c=>c.id===result.connectionId);
  if(connection?.current_version_id)setUsage(current=>({...current,[connection.current_version_id!]:result.usage??connectionUsagePlaceholder(connection.provider)}));
  return result;
 }
 async function refresh(){
  const visit=reading.current;if(!visit.active)return;
  const request=++visit.sequence;visit.controller?.abort();const controller=new AbortController();visit.controller=controller;
  const owns=()=>visit.active&&request===visit.sequence&&!controller.signal.aborted;
  try{const value=await localRequest('connections',{signal:controller.signal});if(owns()){setData(value);savedModels.current=false;setError('');}}
  catch(cause){if(owns()){setError(savedModels.current?'模型设置已保存；连接目录刷新失败，请重新读取。':'连接目录读取失败，请重试。');throw cause;}}
  finally{if(request===visit.sequence)visit.controller=null;}
 }
 const {command,error,setError,pending}=useConnectionActions(refresh);
 useEffect(()=>{const visit=reading.current;visit.active=true;void refresh().catch(()=>{});return()=>{visit.active=false;visit.sequence++;visit.controller?.abort();};},[]);
 return <section aria-label="本地连接" className="dan-ui local-connections-panel">{error&&!data&&<div className="form-error" role="alert"><p>{error}</p><Button color="secondary" size="sm" onPress={()=>void refresh().catch(()=>{})}>重新读取连接</Button></div>}{data&&<><ConnectionWorkspace inlineBilling={inlineBilling} settingsLayout={settingsLayout} navigation={navigation} usageByVersion={usage} serviceCatalog={data.serviceCatalog} errorMessage={error} verificationByProvider={data.capabilities.verificationByProvider} statusMessage={data?.capabilities.verificationAvailable?'测试已启用 · 内容生成需单独授权':data?.capabilities.secrets==='keychain'&&data.capabilities.networkAvailable===false?'凭据仅保存到本机 Keychain · 在线验证已锁定':data?.capabilities.externalReady?'已启用 · 每个版本需独立验证':'真实Keychain和在线验证尚未启用；保存或模拟检查不能作为生产就绪证明。'} onRefresh={()=>void refresh().catch(()=>{})} connections={data.connections} versions={data.versions} secretStorage="本机 Keychain（需授权）" isPending={pending} verificationEnabled={data.capabilities.verificationAvailable??data.capabilities.networkAvailable!==false}
 onCreateConnection={async input=>{try{return (await command<{connection:ExternalConnection}>('create',input)).connection;}catch{return null;}}}
 onRotateConnection={async input=>{try{return (await command<{connection:ExternalConnection}>('rotate',input)).connection;}catch{return null;}}}
 onChangeRegion={async input=>{try{return (await command<{connection:ExternalConnection}>('region',input)).connection;}catch{return null;}}}
 onUpdateConnection={async input=>{await command('update',input);}}
 onRevokeVersion={async versionId=>{await command('revoke',{versionId});}}
 onRebindVersion={async(versionId,secret)=>{await command('rebind',{versionId,secret});}}
 onTestConnection={connectionId=>command('verify',{connectionId})}
 onReadUsage={settingsLayout?async connectionId=>(await localRequest('connection-usage?connectionId='+connectionId) as ConnectionUsageRead).usage:undefined}
 onReadBilling={data.capabilities.billing?connectionId=>localRequest('connection-billing?connectionId='+connectionId):undefined}
 onSaveBilling={async(input,key)=>{beginBilling(input.connectionId);return applyBilling(await localBillingCommand<ConnectionBillingSettings>('save',input,key));}}
 onRefreshBilling={async input=>{beginBilling(input.connectionId);return applyBilling(await localBillingCommand<ConnectionBillingSettings>('refresh',input));}}
 onDisconnectBilling={async input=>{beginBilling(input.connectionId);return applyBilling(await localBillingCommand<ConnectionBillingSettings>('disconnect',input));}}
 onReadModels={connectionId=>localRequest('connection-models?connectionId='+connectionId)}
 onSyncModels={input=>localCommand<ConnectionModelSettings>('sync',input,undefined,'connection-models')}
 onSaveModels={async input=>{const result=await localCommand<ConnectionModelSettings>('save',input,undefined,'connection-models');savedModels.current=true;void refresh().catch(()=>{});return result;}}
 /></>}</section>;
}
