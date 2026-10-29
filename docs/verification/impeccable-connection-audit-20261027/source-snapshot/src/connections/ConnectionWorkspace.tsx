import {ConnectionTestButton} from './ConnectionTestButton';
import {videoProviders} from "../worker/videoProviderCatalog";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Database } from "../lib/database.types";

export type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"] & {
  usage?: {currentBlueprints:number; episodes:number; tasks:number};
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
};

const statusLabels: Record<ExternalConnection["status"] | ExternalConnectionVersion["status"], string> = {
  unverified: "未测试", verified: "已验证", invalid: "认证失败", retryable: "暂时失败", revoked: "已撤销",
};

export function ExternalConnectionPicker({ adapter, connections, isPending = false, label = "外部连接", officialEndpoint, onCreateConnection, onRotateConnection, onSelectVersion, onTestConnection, onUpdateConnection, provider, selectedVersionId, versions = [] }: {
  adapter: ExternalConnectionInput["adapter"];
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
  const [editName, setEditName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const compatibleConnections = connections.filter((connection) => connection.provider === provider && connection.adapter === adapter);
  const compatibleVersions = versions.filter((version) => version.provider === provider && version.adapter === adapter && version.is_current && version.status === "verified" && !version.revoked_at).sort((left, right) => right.version - left.version);
  const selectedReference = versions.find(version=>version.id===selectedVersionId&&version.provider===provider&&version.adapter===adapter);
  const selectedVersion = compatibleVersions.find(version=>version.id===selectedVersionId) ?? (selectedReference?compatibleVersions.find(version=>version.connection_id===selectedReference.connection_id):compatibleVersions[0]);
  const currentVersion = versions.find(version=>version.connection_id===selectedReference?.connection_id&&version.provider===provider&&version.adapter===adapter&&version.is_current&&!version.revoked_at) ?? selectedVersion ?? versions.find(version=>compatibleConnections.some(connection=>connection.id===version.connection_id)&&version.provider===provider&&version.adapter===adapter&&version.is_current&&!version.revoked_at);
  const connectionNames = new Map(compatibleConnections.map((connection) => [connection.id, connection.name]));
  const selectedConnection = compatibleConnections.find((connection) => connection.id === (currentVersion?.connection_id ?? selectedVersion?.connection_id)) ?? compatibleConnections[0];

  useEffect(() => {
    if (selectedVersion && selectedVersion.id !== selectedVersionId) onSelectVersion(selectedVersion.id);
  }, [onSelectVersion, selectedVersion, selectedVersionId]);
  useEffect(() => { setEditName(selectedConnection?.name ?? ""); setIsEditing(false); }, [selectedConnection?.id, selectedConnection?.name]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreateConnection||operationLock.current) return;
    operationLock.current=true;setOperation('saving');setNotice('');setError("");
    try {
      const connection = await onCreateConnection({ adapter, name: name.trim(), provider, secret: provider === "bailian" ? JSON.stringify({ apiKey: secret.trim(), workspaceId: workspaceId.trim() }) : secret });
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
        const connection = await onRotateConnection({ adapter, connectionId: selectedConnection.id, provider, secret: provider === "bailian" ? JSON.stringify({ apiKey: nextSecret, workspaceId: workspaceId.trim() }) : nextSecret });
        if(!connection)throw new Error("连接更新未确认完成，请检查提示后重试。");setRotationSecret("");await testSaved(connection.id);
        if (connection?.current_version_id) onSelectVersion(connection.current_version_id);
      }
      setRotationSecret("");
      setIsEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法更新外部连接。"); }finally{operationLock.current=false;setOperation('');}
  }

  const workspaceField = provider === "bailian" ? <label>北京业务空间 ID 或 Base URL（可选）<input aria-label="百炼业务空间 ID" autoComplete="off" onChange={(event) => setWorkspaceId(event.target.value)} placeholder="ws-… 或控制台复制的 https://… Base URL" value={workspaceId} /><small>认证更新时请重新填写所属空间；留空使用 DashScope。测试只查模型目录，不生成视频。</small></label> : null;

  return <div className="external-connection-picker" aria-label={`${label}连接`}>
    {selectedConnection ? <><section className="external-connection-current"><div><span>当前连接</span><strong>{connectionNames.get(selectedConnection.id) ?? "Owner 连接"}{currentVersion ? ` · v${currentVersion.version} · ${statusLabels[currentVersion.status]}` : " · 未测试"}</strong>{selectedConnection.last_verification_detail ? <small>{selectedConnection.last_verification_detail}</small> : null}</div>{onTestConnection ? <ConnectionTestButton testing={operation==='testing'} disabled={busy} onTest={()=>testCurrent(selectedConnection.id)}/> : null}<button aria-expanded={isEditing} className="button button-secondary button-small" disabled={busy} onClick={() => setIsEditing((open) => !open)} type="button">更新连接</button></section>{isEditing ? <div className="external-connection-edit"><label>连接名称<input aria-label="编辑连接名称" disabled={busy||!onUpdateConnection} onChange={(event) => setEditName(event.target.value)} value={editName} /></label><label>新的 API Key（可选）<input aria-label="编辑连接 API Key" autoComplete="off" onChange={(event) => setRotationSecret(event.target.value)} placeholder={provider === "kling" ? "API Key 或 Access Key:Secret Key" : provider === "cloudflare" ? "Account ID:API Token" : provider === "volcengine_tts" ? "豆包语音 API Key" : undefined} type="password" value={rotationSecret} /></label>{workspaceField}<p className="field-hint">只改名称不会创建新版本；填写新的 API Key 才会创建新版本并测试。</p><button className="button button-secondary button-small" disabled={busy || (!rotationSecret.trim() && (!onUpdateConnection || !editName.trim() || editName.trim() === selectedConnection.name))} onClick={() => void updateCurrentConnection()} type="button">{operation==='saving'?'保存中…':operation==='testing'?'测试中…':'保存连接更新'}</button></div> : null}</> : onCreateConnection ? <form className="external-connection-create" onSubmit={(event) => void create(event)}><p>{provider === "cloudflare" ? "填写 Cloudflare Account ID:Workers AI API Token；验证通过后会直接用于此能力。" : provider === "volcengine_tts" ? "填写新版豆包语音控制台生成的 API Key；测试与正式合成使用同一 V3 接口。" : "创建并测试一条当前连接；验证通过后会直接用于此能力。"}</p><label>连接名称（自定义填写）<input aria-label="新连接名称" onChange={(event) => setName(event.target.value)} required value={name} /></label><label>认证材料（填写对应服务的 API Key）<input aria-label="新连接认证材料" autoComplete="off" onChange={(event) => setSecret(event.target.value)} placeholder={provider === "kling" ? "API Key 或 Access Key:Secret Key" : provider === "cloudflare" ? "Account ID:API Token" : provider === "volcengine_tts" ? "豆包语音 API Key" : undefined} required type="password" value={secret} /></label><button className="button button-secondary button-small" disabled={busy || !name.trim() || !secret.trim()} type="submit">{operation==='saving'?'保存中…':operation==='testing'?'测试中…':'创建并测试连接'}</button></form> : null}
    {!selectedConnection ? workspaceField : null}
    {officialEndpoint || selectedVersion ? <p className="field-hint">官方 Endpoint：{officialEndpoint ?? selectedVersion?.endpoint}</p> : null}
    {notice&&<p role="status" className="muted-copy">{notice}</p>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}

const connectionTypes = [
  ...Object.entries(videoProviders).map(([provider, p]) => ({provider: provider as keyof typeof videoProviders, adapter: p.adapter, label: p.label, secretLabel: provider === "kling" ? "API Key（旧版可填 Access Key:Secret Key）" : p.label+" API Key"})),
  { adapter: "wan_video", label: "百炼万相视频", provider: "bailian", secretLabel: "百炼 API Key" },
  { adapter: "pexels_video", label: "Pexels B-roll", provider: "pexels", secretLabel: "Pexels API Key" },
  { adapter: "freesound_preview", label: "Freesound 配乐 / 音效", provider: "freesound", secretLabel: "Freesound API Key" },
  { adapter: "openai_images", label: "OpenAI Images", provider: "openai", secretLabel: "OpenAI API Key" },
  { adapter: "volcengine_tts", label: "豆包语音 V3", provider: "volcengine_tts", secretLabel: "豆包语音 API Key" },
] as const;

export function ConnectionWorkspace({ connections, isPending = false, onCreateConnection, onDeleteVersion, onRevokeVersion, onRotateConnection, onTestConnection, onUpdateConnection, onRebindVersion, secretStorage='Vault', verificationEnabled=true, showHeader=true, versions = [] }: {
  connections: ExternalConnection[];
  isPending?: boolean;
  onCreateConnection: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>;
  onDeleteVersion?: (versionId: string) => Promise<void>;
  onRevokeVersion?: (versionId: string) => Promise<void>;
  onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>;
  onTestConnection: (connectionId: string) => Promise<unknown>;
  onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>;
  onRebindVersion?: (versionId:string,secret:string) => Promise<void>;
  secretStorage?:string;
  verificationEnabled?:boolean;
  showHeader?:boolean;
  versions?: ExternalConnectionVersion[];
}) {
  const [selectedId,setSelectedId]=useState('');
  const [name,setName]=useState(''),[description,setDescription]=useState(''),[secret,setSecret]=useState('');
  const [adapter,setAdapter]=useState<ExternalConnectionInput["adapter"]>('pexels_video');
  const [workspaceId,setWorkspaceId]=useState(''),[query,setQuery]=useState('');
  const [operation,setOperation]=useState<''|'saving'|'testing'>('');
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [rebindSecrets,setRebindSecrets]=useState<Record<string,string>>({});
  const operationLock=useRef(false),editor=useRef<HTMLFormElement>(null);
  const selected=connections.find(connection=>connection.id===selectedId);
  const connectionType=connectionTypes.find(candidate=>candidate.adapter===(selected?.adapter??adapter))??connectionTypes[0];
  const busy=isPending||operation!=='';
  const currentConnections=connections;
  const matches=(connection:ExternalConnection)=>[connection.name,connection.provider,connection.description??''].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const selectedVersions=versions.filter(version=>version.connection_id===selectedId);

  function choose(id:string){
    if(busy)return;
    const connection=connections.find(item=>item.id===id);
    setSelectedId(id);setName(connection?.name??'');setDescription(connection?.description??'');
    setSecret('');setWorkspaceId('');setRebindSecrets({});setError('');setNotice('');
  }
  function edit(id:string){choose(id);editor.current?.scrollIntoView({block:'start',behavior:'instant'});editor.current?.querySelector('input')?.focus();}
  useEffect(()=>{if(selectedId&&!connections.some(connection=>connection.id===selectedId)){setSelectedId('');setName('');setDescription('');setSecret('');}},[connections,selectedId]);

  async function test(connectionId:string){
    const result=await onTestConnection(connectionId) as {detail?:string;ready?:boolean}|undefined;
    if(result?.ready===false)setError(result.detail??'连接尚未验证通过。');
    else setNotice(result?.detail??'测试已结束，请查看连接状态。');
    return result;
  }
  async function testSelected(connectionId:string){
    if(operationLock.current)return;
    operationLock.current=true;setOperation('testing');setError('');setNotice('');
    try{return await test(connectionId);}finally{operationLock.current=false;setOperation('');}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(operationLock.current||busy)return;
    operationLock.current=true;setOperation('saving');setError('');setNotice('');
    try{
      let connection:ExternalConnection|null=selected??null;
      const credential=connectionType.provider==='bailian'?JSON.stringify({apiKey:secret.trim(),workspaceId:workspaceId.trim()}):secret;
      if(selected){
        if(onUpdateConnection&&(name.trim()!==selected.name||description!==(selected.description??'')))await onUpdateConnection({connectionId:selected.id,name:name.trim(),description});
        if(secret.trim()&&onRotateConnection){
          connection=await onRotateConnection({connectionId:selected.id,adapter:connectionType.adapter,provider:connectionType.provider,secret:credential});
          if(!connection)return;
        }
      }else{
        connection=await onCreateConnection({adapter:connectionType.adapter,name:name.trim(),provider:connectionType.provider,secret:credential});
        if(!connection)return;
      }
      const credentialChanged=!selected||Boolean(secret.trim());
      if(!connection)return;
      setSecret('');
      if(!selected){setName('');setDescription('');setWorkspaceId('');}
      setNotice(credentialChanged?'认证材料已保存。':'连接资料已保存。');
      if(credentialChanged&&verificationEnabled){setOperation('testing');await test(connection.id);}
    }catch(cause){setError(cause instanceof Error?cause.message:'连接保存未确认完成，请重试。');}
    finally{operationLock.current=false;setOperation('');}
  }
  async function rebind(version:ExternalConnectionVersion){
    const value=rebindSecrets[version.id];if(!value||!onRebindVersion||operationLock.current||busy)return;
    if(!window.confirm(`重新绑定 v${version.version} 的缺失秘密？现有秘密不能覆盖，需重新验证；更换认证材料应创建新版本。`))return;
    operationLock.current=true;setOperation('saving');
    try{setError('');await onRebindVersion(version.id,value);setRebindSecrets(current=>({...current,[version.id]:''}));}
    catch{setError('重新绑定失败，请检查缺失状态或使用版本轮换。');}
    finally{operationLock.current=false;setOperation('');}
  }
  function storedList(items:ExternalConnection[]){return <ul className="connection-list-items connection-summary-list">{items.map(connection=>{
    const current=versions.find(version=>version.connection_id===connection.id&&version.is_current);
    const label=connectionTypes.find(type=>type.adapter===connection.adapter)?.label??connection.provider;
    return <li className="connection-list-item" key={connection.id}><div className="connection-item-heading"><div><strong>{connection.name}</strong><span>{label} · v{current?.version??'?'}{connection.usage?` · ${connection.usage.currentBlueprints} 个当前配置 / ${connection.usage.episodes} 个生产单`:''}</span></div><span className="connection-item-status" data-status={connection.status}>{statusLabels[connection.status]}</span></div>{connection.description&&<p className="connection-verification-detail">{connection.description}</p>}<button aria-label={`编辑 ${connection.name}`} className="button button-secondary button-small" disabled={busy} onClick={()=>edit(connection.id)} type="button">编辑</button></li>;
  })}</ul>;}

  return <section className="configuration-form connection-workspace" aria-label="外部连接管理">
    {showHeader&&<header><h2>外部连接</h2><p>凭据保存在 {secretStorage}，不会回显。</p></header>}
    <form aria-label="保存连接" className="connection-create-form" onSubmit={event=>void submit(event)} ref={editor}>
      <fieldset className="connection-create-fields" disabled={busy}><legend>{selected?'编辑连接':'新建连接'}</legend>
        <label className="connection-editor-target">操作对象<select aria-label="操作对象" onChange={event=>choose(event.target.value)} value={selectedId}><option value="">新建连接</option><optgroup label="已保存连接">{currentConnections.map(connection=><option key={connection.id} value={connection.id}>{connection.name}</option>)}</optgroup></select></label>
        <label>连接类型<select aria-label="连接类型" disabled={Boolean(selected)} onChange={event=>{setAdapter(event.target.value as ExternalConnectionInput['adapter']);setSecret('');setWorkspaceId('');}} value={selected?.adapter??adapter}>{connectionTypes.map(type=><option key={type.adapter} value={type.adapter}>{type.label}</option>)}</select></label>
        <label>连接名称<input aria-label="连接名称" autoComplete="off" maxLength={100} onChange={event=>setName(event.target.value)} required value={name}/></label>
        {selected&&<label className="connection-editor-target">连接说明<textarea aria-label="连接说明" maxLength={500} onChange={event=>setDescription(event.target.value)} rows={2} value={description}/></label>}
        <label className="connection-secret-field">{selected?'新的 API Key（选填）':connectionType.secretLabel}<input aria-label={selected?'新的 API Key':connectionType.secretLabel} autoComplete="off" onChange={event=>setSecret(event.target.value)} required={!selected} type="password" value={secret}/>{selected&&<small>留空保留原 Key；填写后创建新版本{verificationEnabled?'并测试':''}。</small>}</label>
        {connectionType.provider==='bailian'&&<label>北京业务空间 ID 或 Base URL（可选）<input aria-label="百炼业务空间 ID" autoComplete="off" onChange={event=>setWorkspaceId(event.target.value)} value={workspaceId}/></label>}
        {selected&&<div className="connection-editor-target"><p className="connection-verification-detail">{statusLabels[selected.status]} · {selected.last_verification_detail}</p>{selected.usage&&<p className="field-hint">当前配置 {selected.usage.currentBlueprints} · 生产单 {selected.usage.episodes} · 任务 {selected.usage.tasks}</p>}</div>}
        <div className="configuration-actions">{selected&&<><button className="button button-secondary" onClick={()=>choose('')} type="button">新建连接</button><ConnectionTestButton disabled={!verificationEnabled} onTest={()=>testSelected(selected.id)}/></>}<button aria-busy={operation!==''} className="button button-primary" disabled={busy||!name.trim()||(!selected&&!secret.trim())||Boolean(selected&&!onUpdateConnection&&!secret.trim())} type="submit">{operation==='testing'?<><span aria-hidden="true" className="connection-test-spinner"/>测试中…</>:operation==='saving'?'保存中…':selected?'保存连接更新':verificationEnabled?'保存并测试':'仅保存凭据'}</button></div>
      </fieldset>
    </form>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="muted-copy" role="status">{notice}</p>}
    {selected&&selectedVersions.length>0&&<details className="connection-item-details"><summary>连接版本（{selectedVersions.length}）</summary><ul className="connection-version-list">{selectedVersions.map(version=><li key={version.id}><span>v{version.version} · {statusLabels[version.status]}{version.is_current?' · 当前':''}</span>{onRebindVersion&&!version.revoked_at&&version.secretState==='unbound'&&<details><summary>恢复缺失的秘密绑定</summary><p>此版本不会自动使用其他版本的认证材料。</p><input aria-label={`v${version.version} 恢复认证材料`} type="password" autoComplete="off" value={rebindSecrets[version.id]??''} onChange={event=>setRebindSecrets(current=>({...current,[version.id]:event.target.value}))}/><button className="button button-secondary button-small" type="button" disabled={busy||!rebindSecrets[version.id]} onClick={()=>void rebind(version)}>重新绑定此版本</button></details>}{version.revoked_at?<small>已撤销</small>:onRevokeVersion&&<button className="button button-danger-soft button-small" disabled={busy} onClick={()=>{if(window.confirm('撤销此连接版本？引用它的生产单不会自动切换。'))void onRevokeVersion(version.id);}} type="button">撤销版本</button>}{version.status==='unverified'&&!version.is_current&&onDeleteVersion&&<button className="button button-secondary button-small" disabled={busy} onClick={()=>{if(window.confirm('删除这个未引用的连接草稿？删除后不可恢复。'))void onDeleteVersion(version.id);}} type="button">删除草稿</button>}</li>)}</ul></details>}
    <section aria-label="连接列表" className="connection-list">
      <label>查找已存连接<input aria-label="查找已存连接" onChange={event=>setQuery(event.target.value)} type="search" value={query}/></label>
      <details className="connection-stored-group" open={query.trim()?true:undefined}><summary>已保存连接（{currentConnections.length}）</summary>{storedList(currentConnections.filter(matches))}</details>

      {!connections.length&&<p className="summary-empty">连接池为空。先添加一条经过显式验证的外部连接。</p>}
      {query.trim()&&!connections.some(matches)&&<p className="summary-empty">没有匹配的连接。</p>}
    </section>
  </section>;
}
