import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Database } from "../lib/database.types";

export type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"];

export type ExternalConnectionInput = {
  name: string;
  provider: "pexels" | "freesound" | "openai" | "cloudflare" | "google_tts";
  adapter: "pexels_video" | "freesound_preview" | "openai_images" | "workers_ai_images" | "google_tts";
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
  onTestConnection?: (connectionId: string) => Promise<void>;
  onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>;
  provider: ExternalConnectionInput["provider"];
  selectedVersionId: string;
  versions?: ExternalConnectionVersion[];
}) {
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [rotationSecret, setRotationSecret] = useState("");
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const compatibleConnections = connections.filter((connection) => connection.provider === provider && connection.adapter === adapter);
  const compatibleVersions = versions.filter((version) => version.provider === provider && version.adapter === adapter && version.is_current && version.status === "verified" && !version.revoked_at).sort((left, right) => right.version - left.version);
  const selectedVersion = compatibleVersions.find((version) => version.id === selectedVersionId) ?? compatibleVersions[0];
  const connectionNames = new Map(compatibleConnections.map((connection) => [connection.id, connection.name]));
  const selectedConnection = selectedVersion ? compatibleConnections.find((connection) => connection.id === selectedVersion.connection_id) : compatibleConnections[0];

  useEffect(() => {
    if (selectedVersion && selectedVersion.id !== selectedVersionId) onSelectVersion(selectedVersion.id);
  }, [onSelectVersion, selectedVersion, selectedVersionId]);
  useEffect(() => { setEditName(selectedConnection?.name ?? ""); }, [selectedConnection?.id, selectedConnection?.name]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreateConnection) return;
    setError("");
    try {
      const connection = await onCreateConnection({ adapter, name: name.trim(), provider, secret });
      if (connection) {
        setName("");
        setSecret("");
        if (onTestConnection) await onTestConnection(connection.id);
        if (connection.current_version_id) onSelectVersion(connection.current_version_id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建外部连接。"); }
  }

  async function updateCurrentConnection() {
    if (!selectedConnection) return;
    const name = editName.trim();
    const nextSecret = rotationSecret.trim();
    if (!name) { setError("连接名称不能为空。"); return; }
    setError("");
    try {
      if (name !== selectedConnection.name && onUpdateConnection) await onUpdateConnection({ connectionId: selectedConnection.id, description: selectedConnection.description ?? "", name });
      if (nextSecret && onRotateConnection) {
        const connection = await onRotateConnection({ adapter, connectionId: selectedConnection.id, provider, secret: nextSecret });
        if (connection && onTestConnection) await onTestConnection(connection.id);
        if (connection?.current_version_id) onSelectVersion(connection.current_version_id);
      }
      setRotationSecret("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法更新外部连接。"); }
  }

  return <div className="external-connection-picker" aria-label={`${label}连接`}>
    {selectedConnection ? <><section className="external-connection-current"><div><span>当前连接</span><strong>{connectionNames.get(selectedConnection.id) ?? "Owner 连接"}{selectedVersion ? ` · v${selectedVersion.version}` : " · 待验证"}</strong></div>{onTestConnection ? <button className="button button-secondary button-small" disabled={isPending} onClick={() => void onTestConnection(selectedConnection.id)} type="button">重新测试</button> : null}</section><details><summary>更新连接</summary><label>连接名称<input aria-label="编辑连接名称" disabled={!onUpdateConnection} onChange={(event) => setEditName(event.target.value)} value={editName} /></label><label>新的认证材料（可选）<input aria-label="编辑连接认证材料" autoComplete="off" onChange={(event) => setRotationSecret(event.target.value)} placeholder={provider === "cloudflare" ? "Account ID:API Token" : undefined} type="password" value={rotationSecret} /></label><p className="field-hint">只改名称不会创建新版本；填写认证材料才会创建新版本并测试。</p><button className="button button-secondary button-small" disabled={isPending || (!rotationSecret.trim() && (!onUpdateConnection || !editName.trim() || editName.trim() === selectedConnection.name))} onClick={() => void updateCurrentConnection()} type="button">保存连接更新</button></details></> : onCreateConnection ? <form className="external-connection-create" onSubmit={(event) => void create(event)}><p>{provider === "cloudflare" ? "填写 Cloudflare Account ID:Workers AI API Token；验证通过后会直接用于此能力。" : "创建并测试一条当前连接；验证通过后会直接用于此能力。"}</p><label>连接名称（自定义填写）<input aria-label="新连接名称" onChange={(event) => setName(event.target.value)} required value={name} /></label><label>认证材料（填写对应服务的 API Key）<input aria-label="新连接认证材料" autoComplete="off" onChange={(event) => setSecret(event.target.value)} placeholder={provider === "cloudflare" ? "Account ID:API Token" : undefined} required type="password" value={secret} /></label><button className="button button-secondary button-small" disabled={isPending || !name.trim() || !secret.trim()} type="submit">创建并测试连接</button></form> : null}
    {officialEndpoint || selectedVersion ? <p className="field-hint">官方 Endpoint：{officialEndpoint ?? selectedVersion?.endpoint}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}

const connectionTypes = [
  { adapter: "pexels_video", label: "Pexels B-roll", provider: "pexels", secretLabel: "Pexels API Key" },
  { adapter: "freesound_preview", label: "Freesound 配乐 / 音效", provider: "freesound", secretLabel: "Freesound API Key" },
  { adapter: "openai_images", label: "OpenAI Images", provider: "openai", secretLabel: "OpenAI API Key" },
  { adapter: "workers_ai_images", label: "Cloudflare Workers AI 图片", provider: "cloudflare", secretLabel: "Account ID:Workers AI API Token" },
  { adapter: "google_tts", label: "Google TTS 旁白", provider: "google_tts", secretLabel: "Google TTS API Key" },
] as const;

const statusLabels: Record<ExternalConnection["status"] | ExternalConnectionVersion["status"], string> = {
  unverified: "未测试", verified: "已验证", invalid: "认证失败", retryable: "暂时失败", revoked: "已撤销",
};

export function ConnectionWorkspace({ connections, isPending = false, onCreateConnection, onDeleteVersion, onRevokeVersion, onRotateConnection, onTestConnection, onUpdateConnection, versions = [] }: {
  connections: ExternalConnection[];
  isPending?: boolean;
  onCreateConnection: (input: ExternalConnectionInput) => Promise<ExternalConnection | null>;
  onDeleteVersion?: (versionId: string) => Promise<void>;
  onRevokeVersion?: (versionId: string) => Promise<void>;
  onRotateConnection?: (input: { connectionId: string; provider: ExternalConnectionInput["provider"]; adapter: ExternalConnectionInput["adapter"]; secret: string }) => Promise<ExternalConnection | null>;
  onTestConnection: (connectionId: string) => Promise<void>;
  onUpdateConnection?: (input: { connectionId: string; name: string; description: string }) => Promise<void>;
  versions?: ExternalConnectionVersion[];
}) {
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [adapter, setAdapter] = useState<ExternalConnectionInput["adapter"]>("pexels_video");
  const [rotationSecrets, setRotationSecrets] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const connectionType = connectionTypes.find((candidate) => candidate.adapter === adapter) ?? connectionTypes[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    try {
      const connection = await onCreateConnection({ adapter: connectionType.adapter, name: name.trim(), provider: connectionType.provider, secret });
      if (!connection) return;
      setName(""); setSecret(""); await onTestConnection(connection.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建外部连接。"); }
  }

  async function rotate(connection: ExternalConnection) {
    const nextSecret = rotationSecrets[connection.id]?.trim() ?? "";
    if (!onRotateConnection || !nextSecret) return;
    setError("");
    try {
      const rotated = await onRotateConnection({ adapter: connection.adapter as ExternalConnectionInput["adapter"], connectionId: connection.id, provider: connection.provider as ExternalConnectionInput["provider"], secret: nextSecret });
      if (!rotated) return;
      setRotationSecrets((current) => ({ ...current, [connection.id]: "" })); await onTestConnection(rotated.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法轮换外部连接版本。"); }
  }

  async function saveMetadata(connection: ExternalConnection) {
    if (!onUpdateConnection) return;
    await onUpdateConnection({ connectionId: connection.id, description: descriptions[connection.id] ?? connection.description ?? "", name: names[connection.id]?.trim() || connection.name });
  }

  return <section className="configuration-form connection-workspace" aria-label="外部连接管理">
    <header><div><span className="effective-config-eyebrow">Owner 连接池</span><h2>外部连接</h2><p>秘密只提交给 Vault 和 Worker 测试；蓝图、Episode、任务和普通日志只保存连接版本 ID。连接撤销后不会自动切换。</p></div></header>
    <form onSubmit={(event) => void submit(event)}><fieldset><legend>添加 {connectionType.label} 连接</legend>
      <label><span>连接类型</span><select aria-label="连接类型" onChange={(event) => { setAdapter(event.target.value as ExternalConnectionInput["adapter"]); setSecret(""); }} value={adapter}>{connectionTypes.map((candidate) => <option key={candidate.adapter} value={candidate.adapter}>{candidate.label}</option>)}</select></label>
      <label>连接名称（自定义填写）<input aria-label="连接名称" onChange={(event) => setName(event.target.value)} required value={name} /></label>
      <label>{connectionType.secretLabel}<input aria-label={connectionType.secretLabel} autoComplete="off" onChange={(event) => setSecret(event.target.value)} required type="password" value={secret} /></label>
      <div className="configuration-actions"><button className="button button-primary" disabled={isPending || !name.trim() || !secret.trim()} type="submit">{isPending ? "保存并测试中…" : "保存并测试"}</button></div>
    </fieldset></form>
    {error ? <p className="form-error">{error}</p> : null}
    <section aria-label="连接列表"><h3>已登记连接（{connections.length}）</h3>{connections.length ? <ul>{connections.map((connection) => {
      const connectionVersions = versions.filter((version) => version.connection_id === connection.id);
      return <li key={connection.id}><strong>{names[connection.id] ?? connection.name} · {statusLabels[connection.status]}</strong><span>{connection.provider} · {connection.adapter} · 当前 v{connectionVersions.find((version) => version.is_current)?.version ?? "?"}</span>
        <label>连接名称<input aria-label={`${connection.name} 连接名称`} onChange={(event) => setNames((current) => ({ ...current, [connection.id]: event.target.value }))} value={names[connection.id] ?? connection.name} /></label>
        <label>连接说明<textarea aria-label={`${connection.name} 连接说明`} onChange={(event) => setDescriptions((current) => ({ ...current, [connection.id]: event.target.value }))} value={descriptions[connection.id] ?? connection.description ?? ""} /></label>
        {connection.last_verification_detail ? <p>{connection.last_verification_detail}</p> : null}
        <div className="configuration-actions"><button className="button button-secondary button-small" disabled={isPending} onClick={() => void onTestConnection(connection.id)} type="button">重新测试</button>{onUpdateConnection ? <button className="button button-secondary button-small" disabled={isPending} onClick={() => void saveMetadata(connection)} type="button">保存说明</button> : null}</div>
        {onRotateConnection ? <details><summary>轮换认证版本</summary><label>新的认证材料<input aria-label={`${connection.name} 新的认证材料`} autoComplete="off" onChange={(event) => setRotationSecrets((current) => ({ ...current, [connection.id]: event.target.value }))} type="password" value={rotationSecrets[connection.id] ?? ""} /></label><button className="button button-primary button-small" disabled={isPending || !rotationSecrets[connection.id]?.trim()} onClick={() => void rotate(connection)} type="button">创建新版本并测试</button></details> : null}
        <details><summary>连接版本（{connectionVersions.length}）</summary><ul>{connectionVersions.map((version) => <li key={version.id}><span>v{version.version} · {statusLabels[version.status]}{version.is_current ? " · 当前" : ""}</span>{version.revoked_at ? <small>已撤销</small> : onRevokeVersion ? <button className="button button-danger-soft button-small" disabled={isPending} onClick={() => { if (window.confirm("撤销此连接版本？引用它的生产单不会自动切换。")) void onRevokeVersion(version.id); }} type="button">撤销版本</button> : null}{version.status === "unverified" && !version.is_current && onDeleteVersion ? <button className="button button-secondary button-small" disabled={isPending} onClick={() => { if (window.confirm("删除这个未引用的连接草稿？删除后不可恢复。")) void onDeleteVersion(version.id); }} type="button">删除草稿</button> : null}</li>)}</ul></details>
      </li>;
    })}</ul> : <p className="summary-empty">连接池为空。先添加一条经过显式验证的外部连接。</p>}</section>
  </section>;
}
