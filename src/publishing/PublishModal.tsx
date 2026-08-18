import { useState } from "react";
import type { FormEvent } from "react";
import type { Database } from "../lib/database.types";
import { artifactPreviewKind, localArtifactUrl, useLocalArtifactBlob } from "../reviews/localArtifactPreview";
import { createManualPublicationRecord, type PublicationRecordInput } from "./publicationRecord";

type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type Artifact = Database["public"]["Tables"]["artifacts"]["Row"];
type PublicationRecord = Database["public"]["Tables"]["publication_records"]["Row"];

const artifactLabels: Record<string, string> = {
  cover: "封面",
  final_qc_report: "QC 报告",
  final_render: "视频",
  metadata: "发布元数据",
  publish_package: "发布包",
};

export function PublishModal({ artifacts, episode, isPending, onClose, onRecord, publicationRecords, publishVerification }: { artifacts: Artifact[]; episode: Episode; isPending: boolean; onClose: () => void; onRecord: (input: PublicationRecordInput) => Promise<boolean>; publicationRecords: PublicationRecord[]; publishVerification: boolean }) {
  const episodeArtifacts = artifacts.filter((artifact) => artifact.episode_id === episode.id);
  const [acknowledged, setAcknowledged] = useState(false);
  const [platform, setPlatform] = useState("");
  const [publishingAccount, setPublishingAccount] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [externalContentId, setExternalContentId] = useState("");
  const [publishedAt, setPublishedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setFormError("");
      if (!acknowledged) throw new Error("请确认已在目标平台手工发布并核对发布包。");
      if (!publishVerification) throw new Error("发布包校验未通过，暂不能记录发布。");
      const record = createManualPublicationRecord({ episodeId: episode.id, externalContentId, externalUrl, notes, platform, publishedAt, publishingAccount });
      if (await onRecord(record)) onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "发布记录无效。");
    }
  }

  return <div aria-label="发布确认" aria-modal="true" className="modal-backdrop publish-modal-backdrop" role="dialog">
    <section className="modal-card publish-modal-card">
      <header><div><h2>发布确认</h2><p>{episode.title || "未命名生产单"} · {episode.id.slice(0, 8)}</p></div><button aria-label="关闭发布确认" className="icon-button" onClick={onClose} type="button">×</button></header>
      <div className="publish-modal-overview">
        <div><span>本地 Episode 目录</span><code>episodes/{episode.id}</code></div>
        <div><span>发布包</span><strong>{episodeArtifacts.some((artifact) => artifact.artifact_type === "publish_package") ? "发布包已固定" : "缺少发布包"}</strong></div>
        <div><span>发布包校验</span><strong className={publishVerification ? "publish-verification-passed" : "publish-verification-failed"}>{publishVerification ? "校验已通过" : "尚未通过"}</strong></div>
      </div>
      <section className="publish-materials"><header><div><h3>发布材料</h3><p>视频和封面可直接预览；发布包、QC 报告和元数据保留固定路径供核对。</p></div></header><div className="publish-material-grid">{["final_render", "cover", "publish_package", "final_qc_report", "metadata"].map((artifactType) => { const artifact = episodeArtifacts.find((candidate) => candidate.artifact_type === artifactType); return <PublishMaterialCard artifact={artifact ?? null} key={artifactType} label={artifactLabels[artifactType]} />; })}</div></section>
      {publicationRecords.length ? <section className="publication-history"><h3>已记录发布历史</h3><div>{publicationRecords.map((record) => <article key={record.id}><strong>{record.platform} · {record.publishing_account}</strong><span>{record.status === "published" ? "已发布" : record.status} · {record.published_at ? formatPublicationDate(record.published_at) : "未记录时间"}</span>{record.external_url ? <a href={record.external_url} rel="noreferrer" target="_blank">{record.external_url}</a> : record.external_content_id ? <code>内容 ID：{record.external_content_id}</code> : null}</article>)}</div><p>支持多平台：每个平台分别记录一次，历史记录会追加保存。</p></section> : null}
      <details className="publication-record-form"><summary>确认材料无误后，展开填写发布信息</summary><form onSubmit={(event) => void submit(event)}>
          <label className="checkbox-label"><input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" />我已在目标平台手工发布，并核对发布包内容。</label>
          <div className="publication-record-fields">
            <label>目标平台<input aria-label="目标平台" onChange={(event) => setPlatform(event.target.value)} required value={platform} /></label>
            <label>发布账号或频道<input aria-label="发布账号或频道" onChange={(event) => setPublishingAccount(event.target.value)} required value={publishingAccount} /></label>
            <label>外部 URL<input aria-label="外部 URL" onChange={(event) => setExternalUrl(event.target.value)} placeholder="https://…" value={externalUrl} /></label>
            <label>外部内容 ID<input aria-label="外部内容 ID" onChange={(event) => setExternalContentId(event.target.value)} value={externalContentId} /></label>
            <label>实际发布时间<input aria-label="实际发布时间" onChange={(event) => setPublishedAt(event.target.value)} required type="datetime-local" value={publishedAt} /></label>
            <label className="publication-record-notes">备注<textarea aria-label="发布备注" onChange={(event) => setNotes(event.target.value)} placeholder="可填写标题、封面或发布异常说明" rows={3} value={notes} /></label>
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          <div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending || !publishVerification} type="submit">{isPending ? "记录中…" : "记录发布并完成确认"}</button></div>
        </form></details>
    </section>
  </div>;
}

function PublishMaterialCard({ artifact, label }: { artifact: Artifact | null; label: string }) {
  const kind = artifact ? artifactPreviewKind(artifact.relative_path) : null;
  if (!artifact) return <article><strong>{label}</strong><span className="publish-material-missing">未索引</span></article>;
  return <article className={kind ? "publish-material-card-with-preview" : ""}><strong>{label}</strong>{kind ? <PublishMaterialPreview artifact={artifact} kind={kind} label={label} /> : <span className="publish-material-structured">已固定索引</span>}<span>{artifactName(artifact.relative_path)}</span><code>{artifact.relative_path}</code></article>;
}

function PublishMaterialPreview({ artifact, kind, label }: { artifact: Artifact; kind: "image" | "video" | "audio"; label: string }) {
  const source = localArtifactUrl(artifact.episode_id, artifact.relative_path, artifact.sha256);
  const { error, url } = useLocalArtifactBlob(source);
  return <div aria-label={`${label}预览`} className="publish-material-preview">{error ? <span className="publish-material-preview-error">{error}</span> : url ? kind === "image" ? <img alt={`${label}预览`} src={url} /> : kind === "video" ? <video aria-label={`${label}预览`} controls preload="metadata" src={url} /> : <audio aria-label={`${label}预览`} controls preload="metadata" src={url} /> : <span>正在加载预览…</span>}</div>;
}

function artifactName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function formatPublicationDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
