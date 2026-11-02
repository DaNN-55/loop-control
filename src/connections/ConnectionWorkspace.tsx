import {useWorkspaceLeaveEntry} from '../local-app/WorkspaceDraft';
import {useConnectionDrafts} from './ConnectionDraftSession';
import {ConnectionDraftLeaveDialog} from './ConnectionDraftLeaveDialog';
import type {PanelNavigation} from '../local-app/catalogNavigation';
import {PopulatedFilterSelect} from '../ui/PopulatedFilterSelect';
import {Plug,Plus,Play,MoreHorizontal,Pencil,History,X,RefreshCw,CreditCard} from 'lucide-react';
import {Dialog,Menu,MenuItem,MenuTrigger,Modal,ModalOverlay,Popover} from 'react-aria-components';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {ConnectionTestButton} from './ConnectionTestButton';
import {HelpTip} from '../ui/HelpTip';
import {ConnectionBillingDialog} from './ConnectionBillingDialog';
import {billingProvider,type ConnectionBillingActions} from './connectionBilling';
import {ConnectionModelsDialog,type ConnectionModelActions} from './ConnectionModelsDialog';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {Input} from '../ui/dan-ui/components/base/input/input';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {TextArea} from '../ui/dan-ui/components/base/textarea/textarea';
import '../ui/dan-ui/styles/scoped.css';
import './connections.css';
import {registeredAdapters,productionCapabilityLabels} from '../worker/registeredAdapters';
import {type MiniMaxRegion} from '../worker/videoProviderCatalog';
import {connectionUsagePlaceholder,connectionUsageScope,type ConnectionUsageSummary} from './connectionUsage';
import {buildProductionServiceCatalog,type ProductionServiceCatalog} from './serviceCatalog';
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Database } from "../lib/database.types";

export type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"] & {
  usage?: {currentBlueprints:number; episodes:number; tasks:number};
  region?:MiniMaxRegion;
};

export type ExternalConnectionInput = {
  name: string;
  provider: "pexels" | "freesound" | "openai" | "cloudflare" | "google_tts" | "volcengine_tts" | "bailian" | "volcengine" | "minimax" | "kling";
  adapter: "pexels_video" | "freesound_preview" | "openai_images" | "workers_ai_images" | "google_tts" | "volcengine_tts" | "wan_video" | "seedance_video" | "minimax_video" | "kling_video";
  secret: string;
};

export type ExternalConnectionVersion = {
  adapter: string;
  connection_id: string;
  created_at: string;
  endpoint: string;
  id: string;
  is_current: boolean;
  provider: string;
  revoked_at: string | null;
  status: "unverified" | "verified" | "invalid" | "retryable" | "revoked";
  version: number;
  secretState?:'unbound'|'bound-unchecked';
  usage?:{currentBlueprints:number;episodes:number;tasks:number;activeTasks:number;requests:number;savedSelections:number};
};

const statusLabels: Record<ExternalConnection["status"] | ExternalConnectionVersion["status"], string> = {
  unverified: "未测试", verified: "已验证", invalid: "认证失败", retryable: "暂时失败", revoked: "已撤销",
};
const minimaxSiteOptions=[{value:'cn',label:'国内站（api.minimax.cn）'},{value:'international',label:'国际站（api.minimax.io）'}];
function connectionCredential(provider:ExternalConnectionInput['provider'],secret:string,workspaceId:string,region:MiniMaxRegion){
  return provider==='bailian'?JSON.stringify({apiKey:secret.trim(),workspaceId:workspaceId.trim()}):provider==='minimax'?JSON.stringify({apiKey:secret.trim(),region}):secret;
}

export function ExternalConnectionPicker({ adapter, connections, isPending = false, label = "外部连接", officialEndpoint, onCreateConnection, onRotateConnection, onSelectVersion, onTestConnection, onUpdateConnection, provider, selectedVersionId, versions = [] }: {
  adapter: ExternalConnectionInput["adapter"];
  navigation?:PanelNavigation<'connections'>;
  connections: ExternalConnection[];
  officialEndpoint?: string;
  isPending?: boolean;
  label?: string;
  onCreateConnection?: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>;
  onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>;
  onSelectVersion: (versionId: string) => void;
  onTestConnection?: (connectionId: string) => Promise<unknown>;
  onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>;
  provider: ExternalConnectionInput["provider"];
  selectedVersionId: string;
  versions?: ExternalConnectionVersion[];
}) {
  const [operation,setOperation]=useState<''|'saving'|'testing'>(''),operationLock=useRef(false);
  const [notice,setNotice]=useState('');
  const busy=isPending||operation!=='';
  async function testCurrent(connectionId:string){if(operationLock.current||!onTestConnection)return;operationLock.current=true;setOperation('testing');setError('');setNotice('');try{return await onTestConnection(connectionId);}finally{operationLock.current=false;setOperation('');}}
  async function testSaved(connectionId:string){if(!onTestConnection)return;setOperation('testing');const result=await onTestConnection(connectionId) as {detail?:string;ready?:boolean}|undefined;if(result?.ready===false)setError(result.detail??'连接尚未验证通过，请检查当前状态。');else setNotice(result?.detail??'测试请求已结束，请查看当前连接状态。');}
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [rotationSecret, setRotationSecret] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [minimaxRegion,setMinimaxRegion]=useState<MiniMaxRegion>('cn');
  const [editName, setEditName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const compatibleConnections = connections.filter((connection) => connection.provider === provider && connection.adapter === adapter);
  const compatibleVersions = versions.filter((version) => version.provider === provider && version.adapter === adapter && version.is_current && version.status === "verified" && !version.revoked_at).sort((left, right) => right.version - left.version);
  const selectedReference = versions.find(version=>version.id===selectedVersionId&&version.provider===provider&&version.adapter===adapter);
  const selectedVersion = compatibleVersions.find(version=>version.id===selectedVersionId) ?? (!selectedVersionId&&compatibleVersions.length===1?compatibleVersions[0]:undefined);
  const currentVersion = selectedReference ? versions.find(version=>version.connection_id===selectedReference.connection_id&&version.is_current&&!version.revoked_at)??selectedReference : selectedVersion??(!selectedVersionId&&compatibleConnections.length===1?versions.find(version=>version.connection_id===compatibleConnections[0].id&&version.is_current&&!version.revoked_at):undefined);
  const connectionNames = new Map(compatibleConnections.map((connection) => [connection.id, connection.name]));
  const selectedConnection = compatibleConnections.find(connection=>connection.id===currentVersion?.connection_id)??(!selectedVersionId&&compatibleConnections.length===1?compatibleConnections[0]:undefined);
  useEffect(()=>{setMinimaxRegion(selectedConnection?.region??(selectedConnection?'international':'cn'));},[selectedConnection?.id,selectedConnection?.region]);

  useEffect(() => {
    if (!selectedVersionId && selectedVersion) onSelectVersion(selectedVersion.id);
  }, [onSelectVersion, selectedVersion, selectedVersionId]);
  useEffect(() => { setEditName(selectedConnection?.name ?? ""); setIsEditing(false); }, [selectedConnection?.id, selectedConnection?.name]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreateConnection||operationLock.current) return;
    operationLock.current=true;setOperation('saving');setNotice('');setError("");
    try {
      const connection = await onCreateConnection({ adapter, name: name.trim(), provider, secret: connectionCredential(provider,secret,workspaceId,minimaxRegion) });
      if (connection) {
        setName("");
        setSecret("");
        await testSaved(connection.id);
        if (connection.current_version_id) onSelectVersion(connection.current_version_id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建外部连接。"); }finally{operationLock.current=false;setOperation('');}
  }

  async function updateCurrentConnection() {
    if (!selectedConnection||operationLock.current) return;
    const name = editName.trim();
    const nextSecret = rotationSecret.trim();
    if (!name) { setError("连接名称不能为空。"); return; }
    operationLock.current=true;setOperation('saving');setNotice('');setError("");
    try {
      if (name !== selectedConnection.name && onUpdateConnection) await onUpdateConnection({ connectionId: selectedConnection.id, description: selectedConnection.description ?? "", name });
      if (nextSecret && onRotateConnection) {
        const connection = await onRotateConnection({ adapter, connectionId: selectedConnection.id, provider, secret: connectionCredential(provider,nextSecret,workspaceId,minimaxRegion) });
        if(!connection)throw new Error("连接更新未确认完成，请检查提示后重试。");setRotationSecret("");await testSaved(connection.id);
        if (connection?.current_version_id) onSelectVersion(connection.current_version_id);
      }
      setRotationSecret("");
      setIsEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法更新外部连接。"); }finally{operationLock.current=false;setOperation('');}
  }

  const workspaceField = provider === 'minimax' ? <NativeSelect label="MiniMax 站点" size="sm" disabled={busy||Boolean(selectedConnection&&!rotationSecret.trim())} value={minimaxRegion} onChange={event=>setMinimaxRegion(event.target.value as MiniMaxRegion)} options={minimaxSiteOptions}/> : provider === "bailian" ? <label>百炼业务空间 ID<InputBase size="sm" aria-label="百炼业务空间 ID" autoComplete="off" onChange={(event) => setWorkspaceId(event.target.value)} placeholder="ws-… 或控制台复制的 https://… Base URL" value={workspaceId} /><small>认证更新时请重新填写所属空间；留空使用 DashScope。测试只查模型目录，不生成视频。</small></label> : null;

  return <div className="external-connection-picker" aria-label={`${label}连接`}>
    {compatibleVersions.length>1?<label>使用已保存连接<NativeSelect size="sm" aria-label={`${label} 使用已保存连接`} disabled={busy} value={selectedVersionId} onChange={event=>onSelectVersion(event.target.value)}><option value="">请选择已验证连接</option>{compatibleVersions.map(version=><option key={version.id} value={version.id}>{connectionNames.get(version.connection_id)??"Owner 连接"} · v{version.version}</option>)}</NativeSelect></label>:null}
    {!selectedVersionId&&compatibleVersions.length===1?<p className="field-hint">已带入唯一匹配的已验证连接，无需再次填写 API Key。</p>:null}
    {selectedConnection ? <><section className="external-connection-current"><div><span>当前连接</span><strong>{connectionNames.get(selectedConnection.id) ?? "Owner 连接"}{currentVersion ? ` · v${currentVersion.version} · ${statusLabels[currentVersion.status]}` : " · 未测试"}</strong>{selectedConnection.last_verification_detail ? <small>{selectedConnection.last_verification_detail}</small> : null}</div>{onTestConnection ? <ConnectionTestButton testing={operation==='testing'} disabled={busy} onTest={()=>testCurrent(selectedConnection.id)}/> : null}<Button size="xs" color="secondary" aria-expanded={isEditing} className="button button-secondary button-small" isDisabled={busy} onClick={() => setIsEditing((open) => !open)} type="button">更新连接</Button></section>{isEditing ? <div className="external-connection-edit"><label>连接名称<InputBase size="sm" aria-label="编辑连接名称" isDisabled={busy||!onUpdateConnection} onChange={(event) => setEditName(event.target.value)} value={editName} /></label><label>新的 API Key（可选）<InputBase size="sm" aria-label="编辑连接 API Key" autoComplete="new-password" onChange={(event) => setRotationSecret(event.target.value)} placeholder={provider === "kling" ? "API Key 或 Access Key:Secret Key" : provider === "cloudflare" ? "Account ID:API Token" : provider === "volcengine_tts" ? "豆包语音 API Key" : undefined} type="password" value={rotationSecret} /></label>{workspaceField}<p className="field-hint">只改名称不会创建新版本；填写新的 API Key 才会创建新版本并测试。</p><Button size="xs" color="secondary" className="button button-secondary button-small" isDisabled={busy || (!rotationSecret.trim() && (!onUpdateConnection || !editName.trim() || editName.trim() === selectedConnection.name))} onClick={() => void updateCurrentConnection()} type="button">{operation==='saving'?'保存中…':operation==='testing'?'测试中…':'保存连接更新'}</Button></div> : null}</> : onCreateConnection && compatibleConnections.length===0 ? <form className="external-connection-create" onSubmit={(event) => void create(event)}><p>{provider === "cloudflare" ? "填写 Cloudflare Account ID:Workers AI API Token；验证通过后会直接用于此能力。" : provider === "volcengine_tts" ? "填写新版豆包语音控制台生成的 API Key；测试与正式合成使用同一 V3 接口。" : "创建并测试一条当前连接；验证通过后会直接用于此能力。"}</p><label>连接名称（自定义填写）<InputBase size="sm" aria-label="新连接名称" onChange={(event) => setName(event.target.value)} isRequired value={name} /></label><label>认证材料（填写对应服务的 API Key）<InputBase size="sm" aria-label="新连接认证材料" autoComplete="new-password" onChange={(event) => setSecret(event.target.value)} placeholder={provider === "kling" ? "API Key 或 Access Key:Secret Key" : provider === "cloudflare" ? "Account ID:API Token" : provider === "volcengine_tts" ? "豆包语音 API Key" : undefined} isRequired type="password" value={secret} /></label><Button size="xs" color="secondary" className="button button-secondary button-small" isDisabled={busy || !name.trim() || !secret.trim()} type="submit">{operation==='saving'?'保存中…':operation==='testing'?'测试中…':'创建并测试连接'}</Button></form> : null}
    {!selectedConnection&&compatibleConnections.length>0?<p className="field-hint">{selectedVersionId?"原连接当前不可用，请显式选择可用版本。":"请选择要关联的已验证连接。"}</p>:null}
    {!selectedConnection&&compatibleConnections.length===0 ? workspaceField : null}
    {officialEndpoint || selectedVersion ? <p className="field-hint">官方 Endpoint：{officialEndpoint ?? selectedVersion?.endpoint}</p> : null}
    {notice&&<p role="status" className="muted-copy">{notice}</p>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}

const providerDisplayNames:Record<string,string>={pexels:'Pexels',freesound:'Freesound',openai:'OpenAI',cloudflare:'Cloudflare',google_tts:'Google Cloud',volcengine_tts:'豆包语音',bailian:'阿里云百炼',volcengine:'火山引擎',minimax:'MiniMax',kling:'可灵'};
const providerDisplayName=(provider:string)=>providerDisplayNames[provider]??provider;

const connectionTypes = [...new Map(registeredAdapters.productionChoices().filter(choice=>choice.connection.kind==='owner_managed').map(choice=>[choice.identityKey,choice])).values()].map(choice=>({
  provider:choice.provider as ExternalConnectionInput['provider'],adapter:choice.adapter as ExternalConnectionInput['adapter'],label:choice.label,
  secretLabel:choice.provider==='kling'?'API Key（旧版可填 Access Key:Secret Key）':choice.provider==='pexels'?'Pexels API Key':choice.provider==='volcengine_tts'?'豆包语音 API Key':choice.provider==='openai'?'OpenAI API Key':choice.provider==='bailian'?'百炼 API Key':choice.label+' API Key',
}));

export function ConnectionWorkspace({ navigation,serviceCatalog, connections, usageByVersion={}, isPending = false, onCreateConnection, onDeleteVersion, onRevokeVersion, onRotateConnection, onChangeRegion, onTestConnection, onUpdateConnection, onRebindVersion, onReadModels,onSyncModels,onSaveModels,onReadBilling,onSaveBilling,onRefreshBilling,onDisconnectBilling, secretStorage='Vault', verificationEnabled=true, verificationByProvider, errorMessage='', showHeader=true, statusMessage='', onRefresh, versions = [] }: ConnectionModelActions & ConnectionBillingActions & {
  navigation?:PanelNavigation<'connections'>;
  connections: ExternalConnection[];
  usageByVersion?:Record<string,ConnectionUsageSummary>;
  serviceCatalog?: ProductionServiceCatalog;
  isPending?: boolean;
  onCreateConnection: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>;
  onDeleteVersion?: (versionId: string) => Promise<void>;
  onRevokeVersion?: (versionId: string) => Promise<void>;
  onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>;
  onTestConnection: (connectionId: string) => Promise<unknown>;
  onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>;
  onRebindVersion?: (versionId:string,secret:string) => Promise<void>;
  onChangeRegion?: (input:{connectionId:string;versionId:string;region:MiniMaxRegion})=>Promise<ExternalConnection|null>;
  secretStorage?:string;
  verificationEnabled?:boolean;
  verificationByProvider?:Record<string,{available:boolean;detail:string}>;
  errorMessage?:string;
  showHeader?:boolean;
  statusMessage?:string;
  onRefresh?:()=>void;
  versions?: ExternalConnectionVersion[];
}) {
  const [selectedId,setSelectedId]=useState(navigation?.value.connection??'');
  const viewedConnection=useRef(navigation?.value.connection??'');
  const [modelConnectionId,setModelConnectionId]=useState('');
  const sessionDrafts=useConnectionDrafts();
  const modelDrafts={current:sessionDrafts.models};
  const [billingConnectionId,setBillingConnectionId]=useState('');
  const billingConnection=connections.find(c=>c.id===billingConnectionId);
  const modelConnection=connections.find(c=>c.id===modelConnectionId);
  const [dialog,applyDialog]=useState<''|'new'|'edit'|'detail'>(navigation?.value.connection?'detail':'');
  function setDialog(next:''|'new'|'edit'|'detail'){applyDialog(next);if(next!=='detail'){viewedConnection.current='';navigation?.change({connection:''});}}
  const [showVersions,setShowVersions]=useState(false);
  const [leavePrompt,setLeavePrompt]=useState(false);
  const [revokingId,setRevokingId]=useState(''),[revokeError,setRevokeError]=useState('');
  const revoking=versions.find(version=>version.id===revokingId);
  const revokingConnection=connections.find(connection=>connection.id===revoking?.connection_id);
  async function revoke(){if(!revoking||!onRevokeVersion||operationLock.current||busy)return;operationLock.current=true;setOperation('saving');setRevokeError('');try{await onRevokeVersion(revoking.id);setRevokingId('');}catch(cause){setRevokeError(cause instanceof Error?cause.message:'撤销未确认完成，请重新读取版本后核对。');}finally{operationLock.current=false;setOperation('');}}
  // Session-local non-secret drafts. Never copy credential input into these snapshots.
  const drafts={current:sessionDrafts.connections};
  const editingBaseline=useRef('');
  const connectionBaseline=(connection?:ExternalConnection)=>JSON.stringify(connection?[connection.name,connection.description??'',connection.current_version_id,connection.region]:[]);
  function closeDialog(){setSecret('');setRebindSecrets({});setCredentialFieldRevision(value=>value+1);setLeavePrompt(false);setDialog('');}
  function requestClose(){if(busy)return;if(nonSecretChanged||secret||Object.values(rebindSecrets).some(Boolean))setLeavePrompt(true);else closeDialog();}
  function keepDraft(){drafts.current.set(selectedId||'__new',{baseline:editingBaseline.current,name,description,adapter,workspaceId,region:minimaxRegion});return true;}
  function leave(keep:boolean){if(keep)keepDraft();else drafts.current.delete(selectedId||'__new');closeDialog();}

  const [capabilityFilter,applyCapabilityFilter]=useState(navigation?.value.capability??'all'),[statusFilter,applyStatusFilter]=useState(navigation?.value.status??'');
  const setCapabilityFilter=(capability:string)=>{applyCapabilityFilter(capability);navigation?.change({capability});};
  const setStatusFilter=(status:string)=>{applyStatusFilter(status);navigation?.change({status});};
  const [testingId,setTestingId]=useState('');
  const [name,setName]=useState(''),[description,setDescription]=useState(''),[secret,setSecret]=useState('');
  const [adapter,setAdapter]=useState<ExternalConnectionInput["adapter"]>('pexels_video');
  const [workspaceId,setWorkspaceId]=useState(''),[query,setQuery]=useState(navigation?.value.q??''),[appliedQuery,setAppliedQuery]=useState(navigation?.value.q??'');
  function applyQuery(value:string){const q=value.trim();setQuery(q);setAppliedQuery(q);navigation?.change({q});}
  useEffect(()=>{if(navigation){setQuery(navigation.value.q);setAppliedQuery(navigation.value.q);applyCapabilityFilter(navigation.value.capability);applyStatusFilter(navigation.value.status);if(viewedConnection.current!==navigation.value.connection){viewedConnection.current=navigation.value.connection;setSelectedId(navigation.value.connection);applyDialog(navigation.value.connection?'detail':'');}}},[navigation?.value.q,navigation?.value.capability,navigation?.value.status,navigation?.value.connection]);
  const [minimaxRegion,setMinimaxRegion]=useState<MiniMaxRegion>('cn');
  const [credentialFieldRevision,setCredentialFieldRevision]=useState(0);
  const [operation,setOperation]=useState<''|'saving'|'testing'>('');
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [resultTitle,setResultTitle]=useState(''),[resultName,setResultName]=useState('');
  const [resultConnectionId,setResultConnectionId]=useState('');
  const resultRef=useRef<HTMLDivElement>(null),dialogRef=useRef<HTMLDivElement>(null),revokeDialogRef=useRef<HTMLDivElement>(null);
  const [rebindSecrets,setRebindSecrets]=useState<Record<string,string>>({});
  const operationLock=useRef(false),editor=useRef<HTMLFormElement>(null);
  const selected=connections.find(connection=>connection.id===selectedId);
  const connectionType=connectionTypes.find(candidate=>candidate.adapter===(selected?.adapter??adapter))??(selected?{adapter:selected.adapter as ExternalConnectionInput['adapter'],provider:selected.provider as ExternalConnectionInput['provider'],label:selected.adapter,secretLabel:'API Key'}:connectionTypes[0]);
  const canVerify=verificationByProvider?.[connectionType.provider]?.available??verificationEnabled;
  const verificationDetail=verificationByProvider?.[connectionType.provider]?.detail;
  const metadataChanged=Boolean(selected&&(name.trim()!==selected.name||description!==(selected.description??'')));
  const regionChanged=Boolean(selected?.provider==='minimax'&&minimaxRegion!==(selected.region??'international'));
  const hasChanges=!selected||metadataChanged||Boolean(secret.trim())||regionChanged;
  const nonSecretChanged=dialog==='new'?Boolean(name||description||workspaceId||adapter!=='pexels_video'||minimaxRegion!=='cn'):dialog==='edit'&&Boolean(metadataChanged||regionChanged||workspaceId);
  const busy=isPending||operation!=='';
  useEffect(()=>{if((dialog==='new'||dialog==='edit')&&!nonSecretChanged)drafts.current.delete(selectedId||'__new');},[dialog,nonSecretChanged,selectedId]);
  useWorkspaceLeaveEntry({kind:'connection',dirty:()=>Boolean(dialog&&(nonSecretChanged||secret||Object.values(rebindSecrets).some(Boolean))),hasSecret:()=>Boolean(secret||Object.values(rebindSecrets).some(Boolean)),keep:()=>{leave(true);return true;},discard:()=>leave(false),beforeUnload:()=>{if(nonSecretChanged)keepDraft();}});
  const catalog=serviceCatalog??buildProductionServiceCatalog({connections,versions,externalReady:verificationEnabled});
  const selectedServices=catalog.groups.flatMap(group=>group.services.filter(service=>service.connectionId===selected?.id));
  const capabilityOf=(connection:ExternalConnection)=>catalog.groups.filter(group=>group.services.some(service=>service.connectionId===connection.id)).map(group=>group.label).join('、')||'未注册功能';
  const tableGroups=[...catalog.groups.map(group=>({...group,entries:group.services.flatMap(service=>{
    const connection=connections.find(connection=>connection.id===service.connectionId);
    return connection?[{connection,service}]:[];
  })})),{capability:'unsupported',label:'其他连接',entries:connections.filter(connection=>!catalog.groups.some(group=>group.services.some(service=>service.connectionId===connection.id))).map(connection=>({connection,service:null}))}];
  const filteredGroups=tableGroups.filter(group=>capabilityFilter==='all'||group.capability===capabilityFilter).map(group=>({...group,entries:group.entries.filter(({connection,service})=>(!statusFilter||connection.status===statusFilter)&&[connection.name,providerDisplayName(connection.provider),connection.provider,connection.adapter,connection.description??'',...(service?.models??[]),...(service?.presets??[])].join(' ').toLocaleLowerCase().includes(appliedQuery.toLocaleLowerCase()))}));
  const selectedVersions=versions.filter(version=>version.connection_id===selectedId);
  const selectedCurrentVersion=selectedVersions.find(version=>version.id===selected?.current_version_id)??selectedVersions.find(version=>version.is_current);

  function choose(id:string){
    if(busy)return;
    const connection=connections.find(item=>item.id===id);
    editingBaseline.current=connectionBaseline(connection);
    setCredentialFieldRevision(value=>value+1);
    setSelectedId(id);setName(connection?.name??'');setDescription(connection?.description??'');
    setAdapter('pexels_video');setWorkspaceId('');
    setMinimaxRegion(connection?.region??(connection?'international':'cn'));
    const draft=drafts.current.get(id||'__new');
    if(draft&&draft.baseline===connectionBaseline(connection)){setName(draft.name);setDescription(draft.description);setAdapter(draft.adapter);setWorkspaceId(draft.workspaceId);setMinimaxRegion(draft.region);}else if(draft)drafts.current.delete(id||'__new');
    setSecret('');setRebindSecrets({});setError('');setNotice('');setResultTitle('');setResultName('');setResultConnectionId('');
    if(draft&&draft.baseline!==connectionBaseline(connection)){setNotice('保留的修改所依据的连接已变化，已读取当前资料。');setResultTitle('已读取当前连接');}
  }
  function openConnection(id:string,mode:'edit'|'detail',versionsOpen=false){if(busy)return;choose(id);setShowVersions(versionsOpen);setDialog(mode);if(mode==='detail'){viewedConnection.current=id;navigation?.change({connection:id});}}
  function createConnection(){if(busy)return;choose('');setShowVersions(false);setDialog('new');}
  useEffect(()=>{if(selectedId&&!connections.some(connection=>connection.id===selectedId)){setSelectedId('');setName('');setDescription('');setSecret('');applyDialog('');if(navigation?.value.connection){setNotice('该连接已不可用，请从当前列表重新选择。');viewedConnection.current='';navigation.change({connection:''});}}},[connections,selectedId]);

  useEffect(()=>{if(operation===''&&(notice||error||errorMessage))resultRef.current?.scrollIntoView?.({block:'nearest'});if(operation===''&&(error||errorMessage||revokeError)&&document.activeElement===document.body)(revokingId?revokeDialogRef.current:dialogRef.current)?.focus();},[operation,notice,error,errorMessage,revokeError,revokingId]);

  async function test(connectionId:string,credentialSaved=false){
    setResultConnectionId(connectionId);
    try{const result=await onTestConnection(connectionId) as {detail?:string;ready?:boolean}|undefined;
    setResultTitle(result?.ready===true?'连接测试通过':result?.ready===false?credentialSaved?'凭据已保存，连接测试未通过':'连接测试未通过':credentialSaved?'凭据已保存，测试结果待确认':'测试已结束');
    if(result?.ready===false)setError(result.detail??'连接尚未验证通过。');
    else setNotice(result?.detail??'测试已结束，请查看连接状态。');
    return result;
    }catch(cause){const detail=cause instanceof Error?cause.message:'连接测试未完成，请重试。';setResultTitle(credentialSaved?'凭据已保存，连接测试未完成':'连接测试未完成');setError(detail);return {ready:false,detail};}
  }
  async function testSelected(connectionId:string){
    if(operationLock.current)return;
    operationLock.current=true;setOperation('testing');setTestingId(connectionId);setError('');setNotice('');setResultName(connections.find(item=>item.id===connectionId)?.name??'');
    try{return await test(connectionId);}finally{operationLock.current=false;setOperation('');setTestingId('');}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(operationLock.current||busy)return;
    if(selected&&!hasChanges){if(canVerify){const result=await testSelected(selected.id);if(result?.ready===true)setDialog('');}return;}
    operationLock.current=true;setOperation('saving');setError('');setNotice('');setResultName(name.trim());setResultTitle('');setResultConnectionId('');
    try{
      let connection:ExternalConnection|null=selected??null;
      const credential=connectionCredential(connectionType.provider,secret,workspaceId,minimaxRegion);
      if(selected){
        if(onUpdateConnection&&(name.trim()!==selected.name||description!==(selected.description??'')))await onUpdateConnection({connectionId:selected.id,name:name.trim(),description});
        if(secret.trim()&&onRotateConnection){
          connection=await onRotateConnection({connectionId:selected.id,adapter:connectionType.adapter,provider:connectionType.provider,secret:credential});
          if(!connection)throw new Error('连接保存未确认完成，请检查提示后重试。');
        }
        else if(regionChanged&&onChangeRegion&&selected.current_version_id){
          connection=await onChangeRegion({connectionId:selected.id,versionId:selected.current_version_id,region:minimaxRegion});
          if(!connection)throw new Error('连接站点保存未确认完成，请检查提示后重试。');
        }
      }else{
        connection=await onCreateConnection({adapter:connectionType.adapter,name:name.trim(),provider:connectionType.provider,secret:credential});
        if(!connection)throw new Error('连接保存未确认完成，请检查提示后重试。');
      }
      const credentialChanged=!selected||Boolean(secret.trim())||regionChanged;
      if(!connection)throw new Error('连接保存未确认完成，请检查提示后重试。');
      drafts.current.delete(selectedId||'__new');
      setSecret('');
      if(!selected){setSelectedId(connection.id);setName(connection.name);setDescription(connection.description??'');setWorkspaceId('');}
      setResultTitle(credentialChanged?'凭据已保存':'连接资料已保存');
      setNotice(credentialChanged?'认证材料已保存。':'连接资料已保存。');
      if(canVerify){setOperation('testing');const result=await test(connection.id,credentialChanged);if(result?.ready===true)setDialog('');}
    }catch(cause){setResultTitle('连接保存未确认完成');setError(cause instanceof Error?cause.message:'连接保存未确认完成，请重试。');}
    finally{operationLock.current=false;setOperation('');}
  }
  async function rebind(version:ExternalConnectionVersion){
    const value=rebindSecrets[version.id];if(!value||!onRebindVersion||operationLock.current||busy)return;
    if(!window.confirm(`重新绑定 v${version.version} 的缺失密钥？现有密钥不能覆盖，需重新验证；更换认证材料应创建新版本。`))return;
    operationLock.current=true;setOperation('saving');
    try{setError('');await onRebindVersion(version.id,value);setRebindSecrets(current=>({...current,[version.id]:''}));}
    catch{setError('重新绑定失败，请检查缺失状态或使用版本轮换。');}
    finally{operationLock.current=false;setOperation('');}
  }
  const versionDetails=selected && selectedVersions.length > 0 && <Disclosure label={<>连接版本（{selectedVersions.length}）</>} className="connection-versions" open={showVersions} onToggle={event=>setShowVersions(event.currentTarget.open)}><ul>{selectedVersions.map(version => <li key={version.id}>
      <div className="connection-version-row"><span>v{version.version} · {statusLabels[version.status]}{version.is_current ? ' · 当前' : ''}</span><div className="connection-version-actions">
        {version.revoked_at ? <small>已撤销</small> : onRevokeVersion && <Button color="tertiary-destructive" size="xs" isDisabled={busy} onPress={() => {setRevokeError('');setRevokingId(version.id);}}>撤销版本</Button>}
        {version.status === 'unverified' && !version.is_current && onDeleteVersion && <Button color="tertiary" size="xs" isDisabled={busy} onPress={() => {if(window.confirm('删除这个未引用的连接草稿？删除后不可恢复。'))void onDeleteVersion(version.id);}}>删除草稿</Button>}
      </div></div>
      {onRebindVersion && !version.revoked_at && version.secretState === 'unbound' && <Disclosure label={<>恢复缺失的密钥绑定</>}><p>此版本不会自动使用其他版本的认证材料。</p><Input aria-label={`v${version.version} 恢复认证材料`} size="sm" type="password" autoComplete="off" isDisabled={busy} value={rebindSecrets[version.id] ?? ''} onChange={value => setRebindSecrets(current => ({...current,[version.id]:value}))}/><Button color="secondary" size="sm" isDisabled={busy || !rebindSecrets[version.id]} onPress={() => void rebind(version)}>重新绑定此版本</Button></Disclosure>}
    </li>)}</ul></Disclosure>;
  const operationResult=(operation || errorMessage || error || notice) && <div aria-label="连接操作结果" className="connection-operation-result" data-status={operation ? 'pending' : errorMessage || error ? 'failed' : 'success'} ref={resultRef} role={operation ? 'status' : errorMessage || error ? 'alert' : 'status'}>
    <strong>{operation === 'saving' ? '正在保存连接' : operation === 'testing' ? '正在测试连接' : resultTitle || '操作未确认完成'}</strong>
    {resultName && <span>{resultName}</span>}
    {!operation && <span>{errorMessage || error || notice}</span>}
    {!operation && error && resultConnectionId && <Button color="secondary" size="sm" iconLeading={RefreshCw} isDisabled={busy || !(verificationByProvider?.[connections.find(connection=>connection.id===resultConnectionId)?.provider??connectionType.provider]?.available??verificationEnabled)} onPress={()=>void testSelected(resultConnectionId)}>重新测试</Button>}
    {!operation && (errorMessage || error && !resultConnectionId) && onRefresh && <Button color="secondary" size="sm" iconLeading={RefreshCw} isDisabled={busy} onPress={onRefresh}>重新读取连接</Button>}
  </div>;
  const filteredConnections=filteredGroups.flatMap(group=>group.entries);
  return <section className="dan-ui connection-workspace connection-management-workspace reference-connections" aria-label="外部连接管理">
    <header className="reference-connections-heading">
      <div>{showHeader&&<h2>外部连接</h2>}<p>管理生产能力使用的服务与凭据引用。</p></div>
      <div className="reference-connections-actions"><Button color="primary" size="sm" iconLeading={Plus} isDisabled={busy} onPress={createConnection}>新建连接</Button></div>
    </header>
    <div className="reference-connections-toolbar">
      <form role="search" aria-label="搜索连接" className="reference-connections-search-form" onSubmit={event=>{event.preventDefault();applyQuery(query);}}>
        <Input aria-label="查找已存连接" size="sm" className="reference-connections-search" placeholder="名称、服务或适配器" onChange={setQuery} type="search" value={query}/>
        {(query||appliedQuery)&&<Button aria-label="清除连接搜索" color="tertiary" size="sm" iconLeading={X} onPress={()=>applyQuery('')}/>}
        <Button color="secondary" size="sm" type="submit">搜索</Button>
      </form>
      <PopulatedFilterSelect aria-label="生产能力" size="sm" value={capabilityFilter} onValueChange={setCapabilityFilter} allValue="all" counts={Object.fromEntries(tableGroups.map(group=>[group.capability,group.entries.length]))} options={[{value:'all',label:'全部能力'},...Object.entries(productionCapabilityLabels).map(([value,label])=>({value,label})),{value:'unsupported',label:'其他连接'}]}/>
      <PopulatedFilterSelect aria-label="验证状态" size="sm" value={statusFilter} onValueChange={setStatusFilter} allValue="" counts={Object.fromEntries((['verified','unverified','invalid','retryable']as const).map(status=>[status,connections.filter(connection=>connection.status===status).length]))} options={[{value:'',label:'全部状态'},...(['verified','unverified','invalid','retryable']as const).map(value=>({value,label:statusLabels[value]}))]}/>
    </div>
    {!dialog&&operationResult}
    <section aria-label="连接列表" className="reference-connections-table-wrap">
      <table aria-label="已保存连接"><thead><tr><th scope="col">连接</th><th scope="col">服务</th><th scope="col">模型</th><th scope="col"><span className="reference-connections-column-label">验证<HelpTip label="连接验证">已验证表示凭据曾通过服务检查；内容生成还需单独授权，不代表每次调用必定成功。</HelpTip></span></th><th scope="col">凭据版本</th><th scope="col">额度 / 近7天</th><th scope="col">操作</th><th scope="col"><span className="reference-connections-sr-only">更多操作</span></th></tr></thead>
      {filteredGroups.filter(group=>group.entries.length>0).map(group=><tbody key={group.capability} aria-label={group.label}>
      {capabilityFilter==='all'&&<tr className="reference-connections-group"><td colSpan={8}>{group.label}</td></tr>}
      {group.entries.map(({connection,service})=>{
        const current=versions.find(version=>version.id===connection.current_version_id)??versions.find(version=>version.connection_id===connection.id&&version.is_current);
        const canTest=verificationByProvider?.[connection.provider]?.available??verificationEnabled;
        const executionAuthorizationRequired=service?.unavailableReason==='当前执行网络不可用。';
        const usage=usageByVersion[connection.current_version_id??'']??connectionUsagePlaceholder(connection.provider);
        return <tr key={connection.id} className={capabilityFilter==='all'?'reference-connection-child':undefined}>
          <td><button type="button" className="reference-connection-name" disabled={busy} onClick={()=>openConnection(connection.id,'detail')}>{connection.name}</button>{connection.description&&<div className="reference-connection-secondary">{connection.description}</div>}</td>
          <td className="reference-connection-service">{providerDisplayName(connection.provider)}</td>
          <td className="reference-connection-model">{service?.mode==='search'?service.label:service?.models.length?service.models.map(model=><div key={model}>{model}</div>):service?.mode==='generation'?'未启用模型':service?.presets.length?service.presets.map(preset=><div key={preset}>{preset}</div>):'—'}</td>
          <td><span className="reference-connection-status" title={executionAuthorizationRequired?'当前环境未开放自动执行；内容生成需单独授权。这不是实时网络检测结果。':undefined} data-status={connection.status}><i aria-hidden="true"/>{statusLabels[connection.status]}</span><div className="reference-connection-secondary">{connection.last_verified_at?<>最近验证 <time dateTime={connection.last_verified_at}>{new Date(connection.last_verified_at).toLocaleString('zh-CN',{dateStyle:'short',timeStyle:'short'})}</time></>:connection.status==='verified'?'验证时间未记录':'尚无通过记录'}</div>{!service?.executable&&!executionAuthorizationRequired&&<div className="reference-connection-secondary">{service?.unavailableReason??'未注册或不支持当前制作功能。'}</div>}</td>
          <td>{current?`v${current.version}`:'—'}</td>
          <td className="reference-connection-usage" aria-label={`${connection.name} 额度与用量`}>
            <div className="reference-connection-secondary">{connectionUsageScope(connection.provider)??'供应商用量'}</div>
            {[usage.remaining,usage.recent].map((item,index)=><div key={index} className="reference-connection-usage-line"><span>{item.label}</span><span data-state={item.status}>{connection.provider==='openai'&&index===0&&item.text==='控制台查看'?<a className="connection-billing-console-link" href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer" aria-label="在 OpenAI 控制台查看余额（新窗口）">{item.text}</a>:item.text}</span></div>)}
            <Disclosure label="账务详情" className="reference-connection-usage-details">
              {usage.updatedAt?<p>读取时间 <time dateTime={usage.updatedAt}>{new Date(usage.updatedAt).toLocaleString('zh-CN')}</time></p>:<p>尚无成功读取时间</p>}
              <p>查询结果可能来自缓存，非实时状态；供应商数据可能另有延迟。</p>
              {['minimax','openai','bailian','volcengine','volcengine_tts','kling','freesound'].includes(connection.provider)&&<p>同一供应商账号的多个 Key 可能共享，不应逐连接相加。</p>}
              <p>{usage.remaining.label}：{usage.remaining.detail}</p><p>{usage.recent.label}：{usage.recent.detail}</p>
            </Disclosure>
          </td>
          <td className="reference-connection-test"><Button className="reference-connection-test-button" color="tertiary" size="xs" iconLeading={RefreshCw} aria-label={`测试 ${connection.name}`} isLoading={testingId===connection.id} showTextWhileLoading isDisabled={busy||!canTest} onPress={()=>void testSelected(connection.id)}>{testingId===connection.id?'测试中…':'测试'}</Button></td><td className="reference-connection-more"><MenuTrigger><Button aria-label={`${connection.name} 连接操作`} color="tertiary" size="sm" iconLeading={MoreHorizontal} isDisabled={busy}/><Popover placement="bottom end" className="dan-ui reference-connections-menu"><Menu aria-label={`${connection.name} 操作`} onAction={key=>key==='billing'?setBillingConnectionId(connection.id):key==='models'?setModelConnectionId(connection.id):openConnection(connection.id,key==='edit'?'edit':'detail',key==='versions')}><MenuItem id="edit" textValue="编辑连接"><Pencil aria-hidden="true"/>编辑连接</MenuItem>{onReadModels&&service?.mode==='generation'&&<MenuItem id="models" textValue="模型设置"><RefreshCw aria-hidden="true"/>模型设置</MenuItem>}{onReadBilling&&billingProvider(connection.provider)&&<MenuItem id="billing" textValue="账务设置"><CreditCard aria-hidden="true"/>账务设置</MenuItem>}<MenuItem id="versions" textValue="版本详情"><History aria-hidden="true"/>版本详情</MenuItem></Menu></Popover></MenuTrigger></td>
        </tr>;
      })}</tbody>)}{!filteredConnections.length&&<tbody><tr><td colSpan={8}><div className="reference-connections-empty"><strong>{connections.length?'没有匹配的连接':'尚未添加连接'}</strong><p>{connections.length?'调整筛选条件，或创建新的服务连接。':'添加服务凭据后，验证其连接状态。'}</p>{connections.length>0&&<Button color="secondary" size="sm" onPress={()=>{applyQuery('');setCapabilityFilter('all');setStatusFilter('');}}>清空筛选</Button>}</div></td></tr></tbody>}</table>
    </section>
    {billingConnection&&<ConnectionBillingDialog key={billingConnection.id} connection={billingConnection} onClose={()=>setBillingConnectionId('')} onReadBilling={onReadBilling} onSaveBilling={onSaveBilling} onRefreshBilling={onRefreshBilling} onDisconnectBilling={onDisconnectBilling}/>}
    {modelConnection&&<ConnectionModelsDialog key={modelConnection.id} connection={modelConnection} draft={modelDrafts.current.get(modelConnection.id)} onDraftChange={draft=>{if(draft)modelDrafts.current.set(modelConnection.id,draft);else modelDrafts.current.delete(modelConnection.id);}} onClose={()=>setModelConnectionId('')} onReadModels={onReadModels} onSyncModels={onSyncModels} onSaveModels={onSaveModels}/>}
    <p className="reference-connections-note" role="status">{statusMessage||`凭据保存在 ${secretStorage}，不会回显。`}</p>
    <ModalOverlay className="product-ui reference-connections-overlay" isOpen={Boolean(dialog)} isDismissable={!busy&&!leavePrompt&&!revokingId} isKeyboardDismissDisabled={busy||leavePrompt||Boolean(revokingId)} onOpenChange={open=>{if(!open)requestClose();}}><Modal className="reference-connections-modal"><Dialog ref={dialogRef} aria-label={dialog==='detail'?selected?.name:dialog==='new'?'新建连接':'编辑连接'} className="dan-ui connection-workspace reference-connections reference-connections-dialog">
      <header className="reference-connections-dialog-header"><h2>{dialog==='detail'?selected?.name:dialog==='new'?'新建连接':'编辑连接'}</h2><Button color="tertiary" size="sm" iconLeading={X} aria-label="关闭连接窗口" isDisabled={busy} onPress={requestClose}/></header>
      {dialog==='detail'&&selected?<><div className="reference-connections-detail-body">
        <div className="reference-connection-summary" role="status" title={selected.last_verification_detail||undefined}><span className="reference-connection-status" data-status={selected.status}><i aria-hidden="true"/>{statusLabels[selected.status]}</span>{selectedCurrentVersion&&<span>v{selectedCurrentVersion.version}</span>}<span>{selected.last_verified_at?<>最近测试 <time dateTime={selected.last_verified_at}>{new Date(selected.last_verified_at).toLocaleString('zh-CN',{dateStyle:'short',timeStyle:'short'})}</time></>:'尚未测试'}</span></div>
        <dl className="reference-connections-detail-list"><dt>生产能力</dt><dd>{capabilityOf(selected)}</dd><dt>服务提供方</dt><dd>{providerDisplayName(selected.provider)}</dd><dt>技术标识</dt><dd>{selected.provider}</dd><dt>适配器</dt><dd>{selected.adapter}</dd><dt>模型 / 服务</dt><dd>{selectedServices.map(service=>service.models.length?service.models.join('、'):service.label).join('；')||'未注册或不支持当前制作功能。'}</dd>{selected.endpoint&&<><dt>服务地址</dt><dd>{selected.endpoint}</dd></>}{selected.description&&<><dt>备注</dt><dd>{selected.description}</dd></>}{selected.usage&&(selected.usage.currentBlueprints+selected.usage.episodes+selected.usage.tasks)>0&&<><dt>使用范围</dt><dd>当前配置 {selected.usage.currentBlueprints} · 生产单 {selected.usage.episodes} · 任务 {selected.usage.tasks}</dd></>}</dl>
        {!operationResult&&selected.status!=='verified'&&selected.last_verification_detail&&<p className="reference-connections-note form-error" role="alert">{selected.last_verification_detail}</p>}
        {operationResult}{versionDetails}
      </div><footer className="reference-connections-dialog-footer"><Button color="secondary" size="sm" isDisabled={busy} onPress={()=>{choose(selected.id);setDialog('edit');}}>编辑连接</Button><Button color="primary" size="sm" iconLeading={Play} isDisabled={busy||!canVerify} isLoading={operation==='testing'} showTextWhileLoading onPress={()=>void testSelected(selected.id)}>测试连接</Button></footer></>:<>
    <form aria-label="保存连接" className="connection-editor" onSubmit={event => void submit(event)} ref={editor}>
      <fieldset className="connection-fields" disabled={busy}>
        <p className="reference-connections-note" role="status">{nonSecretChanged||secret?'未保存修改':'尚未修改'}</p>
        <NativeSelect icon={Plug} aria-label="连接类型" className="connection-field" label="连接类型" size="sm" disabled={busy || Boolean(selected)} value={selected?.adapter ?? adapter} onChange={event => {setCredentialFieldRevision(value=>value+1);setAdapter(event.target.value as ExternalConnectionInput['adapter']);setSecret('');setWorkspaceId('');}} options={[...connectionTypes.map(type => ({value:type.adapter,label:type.label})),...(selected&&!connectionTypes.some(type=>type.adapter===selected.adapter)?[{value:selected.adapter,label:selected.adapter}]:[])]}/>
        <Input className="connection-field" label="连接名称" size="sm" autoComplete="off" maxLength={100} isRequired isDisabled={busy} onChange={setName} value={name}/>
        {selected && <TextArea className="connection-field" label="连接说明" size="sm" maxLength={500} isDisabled={busy} onChange={setDescription} rows={2} value={description}/>}
        <Input key={credentialFieldRevision} className="connection-field" label={selected ? '新的 API Key（选填）' : connectionType.secretLabel} size="sm" autoComplete="new-password" isRequired={!selected} isDisabled={busy} onChange={setSecret} type="password" value={secret} hint={selected ? `留空保留原 Key；填写后创建新版本${canVerify ? '并测试' : ''}。` : undefined}/>
        {connectionType.provider === 'bailian' && <Input className="connection-field" label="百炼业务空间 ID" hint="选填北京空间 ID 或 Base URL；留空使用 DashScope。" size="sm" autoComplete="off" isDisabled={busy} onChange={setWorkspaceId} value={workspaceId}/>}
        {connectionType.provider === 'minimax' && <NativeSelect className="connection-field" label="MiniMax 站点" hint={selected&&onChangeRegion?'更换站点会沿用当前 Key 创建新版本。':'选择创建 API Key 的站点。'} size="sm" disabled={busy||Boolean(selected&&!secret.trim()&&!onChangeRegion)} value={minimaxRegion} onChange={event=>setMinimaxRegion(event.target.value as MiniMaxRegion)} options={minimaxSiteOptions}/>}
        {!canVerify && verificationDetail && <p className="connection-availability">{verificationDetail} 可保存凭据。</p>}
        {selected&&selected.status!=='verified'&&selected.last_verification_detail&&!operationResult&&<p className="reference-connections-note form-error" role="alert">{selected.last_verification_detail}</p>}
        {versionDetails}
        {operationResult}
        <div className="connection-submit-row">
          <Button color="secondary" size="sm" isDisabled={busy} onPress={requestClose}>取消</Button>
          <Button aria-busy={operation !== ''} color="primary" size="sm" isLoading={operation !== ''} showTextWhileLoading isDisabled={busy || !name.trim() || (!selected && !secret.trim()) || (!canVerify && !hasChanges) || Boolean(selected && metadataChanged && !onUpdateConnection) || Boolean(selected && secret.trim() && !onRotateConnection)} type="submit">{operation === 'testing' ? '测试中…' : operation === 'saving' ? '保存中…' : canVerify ? hasChanges ? '保存并测试' : '测试连接' : selected ? '保存更新' : '仅保存凭据'}</Button>
        </div>
      </fieldset>
    </form>
      </>}
    </Dialog></Modal></ModalOverlay>
    {revoking&&<ModalOverlay className="product-ui reference-connections-overlay" isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={open=>{if(!open&&!busy)setRevokingId('');}}><Modal className="reference-connections-modal"><Dialog ref={revokeDialogRef} aria-label="撤销连接版本" className="dan-ui connection-workspace reference-connections reference-connections-dialog">
      <header className="reference-connections-dialog-header"><h2>撤销连接版本</h2></header>
      <div className="reference-connections-detail-body"><strong>{revokingConnection?.name} · v{revoking.version}</strong>{revoking.usage?<>
        <p>已记录引用：生产单 {revoking.usage.episodes} · 任务 {revoking.usage.tasks}（待执行或执行中 {revoking.usage.activeTasks}）· 制作请求 {revoking.usage.requests} · 已保存制作选择 {revoking.usage.savedSelections} 项。</p>
        <p>统计已保存的蓝图字段、任务、制作请求快照及配乐 / 口播选择；不包含尚未保存的表单。</p>
        <p>当前蓝图中的旧连接字段引用：{revoking.usage.currentBlueprints}。旧字段仅保留历史记录，不代表当前制作选择。</p>
      </>:<p role="alert">尚未读取此版本的引用影响，请重新读取连接后再撤销。</p>}
      <p>撤销后仍需此版本的本机执行将被阻止，不会取消供应商已接受的请求。历史记录和已冻结输入保留，不会自动切换到其他版本；撤销后不能恢复此版本。</p>
      {revoking.revoked_at&&<p role="status">此版本已撤销。</p>}{revokeError&&<p className="form-error" role="alert">{revokeError}</p>}</div>
      <footer className="reference-connections-dialog-footer"><Button color="secondary" size="sm" autoFocus isDisabled={busy} onPress={()=>setRevokingId('')}>取消撤销</Button><Button color="primary-destructive" size="sm" isLoading={busy} showTextWhileLoading isDisabled={busy||!revoking.usage||Boolean(revoking.revoked_at)} onPress={()=>void revoke()}>确认撤销 v{revoking.version}</Button></footer>
    </Dialog></Modal></ModalOverlay>}
    {leavePrompt&&<ConnectionDraftLeaveDialog hasSecret={Boolean(secret||Object.values(rebindSecrets).some(Boolean))} onContinue={()=>setLeavePrompt(false)} onDiscard={()=>leave(false)} onKeep={nonSecretChanged?()=>leave(true):undefined}/>}
  </section>;
}
