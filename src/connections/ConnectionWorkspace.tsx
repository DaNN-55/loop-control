import { useState } from "react";
import type { FormEvent } from "react";
import type { Database } from "../lib/database.types";

type ExternalConnection = Database["public"]["Tables"]["external_connections"]["Row"];

const statusLabels: Record<ExternalConnection["status"], string> = {
  unverified: "未测试",
  verified: "已验证",
  invalid: "认证失败",
  retryable: "暂时失败",
};

export function ConnectionWorkspace({ connections, isPending = false, onCreateConnection, onTestConnection }: { connections: ExternalConnection[]; isPending?: boolean; onCreateConnection: (input: { name: string; provider: "pexels"; adapter: "pexels_video"; secret: string }) => Promise<ExternalConnection | null>; onTestConnection: (connectionId: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const connection = await onCreateConnection({ adapter: "pexels_video", name: name.trim(), provider: "pexels", secret });
      if (!connection) return;
      setName("");
      setSecret("");
      await onTestConnection(connection.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法创建外部连接。");
    }
  }

  return <section className="configuration-form connection-workspace" aria-label="外部连接管理"><header><div><span className="effective-config-eyebrow">Owner 连接池</span><h2>外部连接</h2><p>连接秘密只在提交和 Worker 测试时使用；控制面、蓝图、Episode、任务和普通日志只保存非秘密连接 ID。</p></div></header><form onSubmit={(event) => void submit(event)}><fieldset><legend>添加 Pexels B-roll 连接</legend><label>连接名称<input aria-label="连接名称" onChange={(event) => setName(event.target.value)} required value={name} /></label><label>Pexels API Key<input aria-label="Pexels API Key" autoComplete="off" onChange={(event) => setSecret(event.target.value)} required type="password" value={secret} /></label><div className="configuration-actions"><button className="button button-primary" disabled={isPending || !name.trim() || !secret.trim()} type="submit">{isPending ? "保存并测试中…" : "保存并测试"}</button></div></fieldset></form>{error ? <p className="form-error">{error}</p> : null}<section aria-label="连接列表"><h3>已登记连接（{connections.length}）</h3>{connections.length ? <ul>{connections.map((connection) => <li key={connection.id}><strong>{connection.name} · {statusLabels[connection.status]}</strong><span>Pexels · {connection.adapter}</span>{connection.last_verification_detail ? <p>{connection.last_verification_detail}</p> : null}<button className="button button-secondary button-small" disabled={isPending} onClick={() => void onTestConnection(connection.id)} type="button">重新测试</button></li>)}</ul> : <p className="summary-empty">连接池为空。先添加并测试一条 Pexels 连接。</p>}</section></section>;
}
