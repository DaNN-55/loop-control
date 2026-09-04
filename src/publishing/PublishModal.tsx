import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Upload } from "lucide-react";
import type { Database } from "../lib/database.types";
import { artifactPreviewKind, localArtifactUrl, useLocalArtifactBlob, useLocalArtifactText } from "../reviews/localArtifactPreview";
import { useDialogFocus } from "../ui/useDialogFocus";
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

export function PublishModal({ artifacts, episode, isPending, isPreparationPending, onClose, onOpenArtifact, onPrepare, onRecord, publicationRecords, publishVerification }: { artifacts: Artifact[]; episode: Episode; isPending: boolean; isPreparationPending: boolean; onClose: () => void; onOpenArtifact: (artifact: Artifact) => Promise<void>; onPrepare: (input: { cover: File; description: string; tags: string[]; title: string }) => Promise<boolean>; onRecord: (input: PublicationRecordInput) => Promise<boolean>; publicationRecords: PublicationRecord[]; publishVerification: boolean }) {
  const dialogRef = useDialogFocus(true, onClose);
  const episodeArtifacts = artifacts.filter((artifact) => artifact.episode_id === episode.id);
  const metadataArtifact = episodeArtifacts.find((artifact) => artifact.artifact_type === "metadata") ?? null;
  const coverArtifact = episodeArtifacts.find((artifact) => artifact.artifact_type === "cover") ?? null;
  const videoArtifact = episodeArtifacts.find((artifact) => artifact.artifact_type === "final_render") ?? null;
  const publishPackageArtifact = episodeArtifacts.find((artifact) => artifact.artifact_type === "publish_package") ?? null;
  const isPublishPackageReady = Boolean(publishPackageArtifact && metadataArtifact && coverArtifact);
  const extraArtifacts = [
    publishPackageArtifact,
    episodeArtifacts.find((artifact) => artifact.artifact_type === "final_qc_report"),
  ].filter((artifact): artifact is Artifact => Boolean(artifact));
  const [acknowledged, setAcknowledged] = useState(false);
  const [platform, setPlatform] = useState("");
  const [publishingAccount, setPublishingAccount] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [externalContentId, setExternalContentId] = useState("");
  const [publishedAt, setPublishedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [publishTitle, setPublishTitle] = useState(episode.title || "");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishTags, setPublishTags] = useState("");
  const [preparationError, setPreparationError] = useState("");

  useEffect(() => {
    if (!cover) { setCoverPreview(""); return; }
    const reader = new FileReader();
    reader.addEventListener("load", () => setCoverPreview(typeof reader.result === "string" ? reader.result : ""));
    reader.readAsDataURL(cover);
    return () => { if (reader.readyState === FileReader.LOADING) reader.abort(); };
  }, [cover]);

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setPreparationError("");
      if (!cover) throw new Error("请选择封面。");
      if (!(["image/jpeg", "image/png", "image/webp"].includes(cover.type) || /\.(jpe?g|png|webp)$/i.test(cover.name))) throw new Error("封面仅支持 JPG、PNG 或 WebP。");
      if (cover.size > 20 * 1024 * 1024) throw new Error("封面不能超过 20 MB。");
      await onPrepare({ cover, description: publishDescription, tags: publishTags.split(/[，,\n]+/).map((tag) => tag.trim()).filter(Boolean), title: publishTitle.trim() });
    } catch (error) {
      setPreparationError(error instanceof Error ? error.message : "无法生成发布包。");
    }
  }

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

  return <div aria-label="发布确认" aria-modal="true" className="modal-backdrop publish-modal-backdrop" ref={dialogRef} role="dialog">
    <section className="modal-card publish-modal-card">
      <header><div><h2>发布确认</h2><p>{episode.title || "未命名生产单"} · {episode.id.slice(0, 8)}</p></div><button aria-label="关闭发布确认" className="icon-button" onClick={onClose} type="button">×</button></header>
      <div className="publish-modal-overview">
        <div><span>本地 Episode 目录</span><code>episodes/{episode.id}</code></div>
        <div><span>发布包</span><strong>{publishPackageArtifact ? "发布包已固定" : "缺少发布包"}</strong></div>
        <div><span>发布包校验</span><strong className={publishVerification ? "publish-verification-passed" : "publish-verification-failed"}>{publishVerification ? "校验已通过" : "尚未通过"}</strong></div>
      </div>
      {!isPublishPackageReady ? <section className="publish-preparation-warning"><strong>发布材料未齐，当前还不能登记发布</strong><p>填写发布信息并选择封面，系统会一次完成材料登记、发布包生成和校验。</p><div className="publish-preparation-layout"><form className="publish-preparation-form" onSubmit={(event) => void prepare(event)}><label>发布标题<input aria-label="发布标题" maxLength={200} onChange={(event) => setPublishTitle(event.target.value)} required value={publishTitle} /></label><label>发布标签<input aria-label="发布标签" onChange={(event) => setPublishTags(event.target.value)} placeholder="用逗号分隔，最多 20 个" value={publishTags} /></label><label className="publish-preparation-description">发布简介<textarea aria-label="发布简介" maxLength={5000} onChange={(event) => setPublishDescription(event.target.value)} rows={3} value={publishDescription} /></label><div className={`publish-preparation-cover${coverPreview ? " has-preview" : ""}`}><label className="material-unified-upload"><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" aria-label="选择封面" className="material-slot-input" onChange={(event) => setCover(event.target.files?.[0] ?? null)} required type="file" /><Upload aria-hidden="true" className="icon" /><span><strong>封面（JPG、PNG、WebP）</strong><small>{cover ? `${cover.name} · ${(cover.size / 1024 / 1024).toFixed(1)} MB` : "点击选择封面，最大 20 MB"}</small></span></label>{coverPreview ? <figure className="publish-selected-cover-preview"><img alt="所选封面预览" src={coverPreview} /><figcaption>封面预览</figcaption></figure> : null}</div>{preparationError ? <p className="form-error">{preparationError}</p> : null}<button className="button button-primary" disabled={isPreparationPending || !cover || !publishTitle.trim()} type="submit">{isPreparationPending ? "生成中…" : "保存并生成发布包"}</button></form><div className="publish-preparation-video"><PublishVisualMaterialCard artifact={videoArtifact} label="最终视频" onOpenArtifact={onOpenArtifact} /></div></div></section> : null}
      {isPublishPackageReady ? <section className="publish-materials"><header><div><h3>发布材料</h3><p>先核对元数据，再查看封面和视频；技术文件按需打开。</p></div></header><PublishMetadataSummary artifact={metadataArtifact} onOpenArtifact={onOpenArtifact} /><div className="publish-visual-material-grid"><PublishVisualMaterialCard artifact={coverArtifact} label="封面" onOpenArtifact={onOpenArtifact} /><PublishVisualMaterialCard artifact={videoArtifact} label="视频" onOpenArtifact={onOpenArtifact} /></div>{extraArtifacts.length ? <details className="publish-extra-materials"><summary>更多材料 <span>QC 报告 · 发布包</span></summary><div className="publish-extra-material-list">{extraArtifacts.map((artifact) => <PublishStructuredMaterialCard artifact={artifact} key={artifact.id} label={artifactLabels[artifact.artifact_type] ?? artifact.artifact_type} onOpenArtifact={onOpenArtifact} />)}</div></details> : null}</section> : null}
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

function PublishMetadataSummary({ artifact, onOpenArtifact }: { artifact: Artifact | null; onOpenArtifact: (artifact: Artifact) => Promise<void> }) {
  if (!artifact) return <section className="publish-metadata-summary"><header><h4>发布元数据</h4><span className="publish-material-missing">未索引</span></header></section>;
  return <PublishMetadataSummaryContent artifact={artifact} onOpenArtifact={onOpenArtifact} />;
}

function PublishMetadataSummaryContent({ artifact, onOpenArtifact }: { artifact: Artifact; onOpenArtifact: (artifact: Artifact) => Promise<void> }) {
  const source = localArtifactUrl(artifact.episode_id, artifact.relative_path, artifact.sha256);
  const { content, error } = useLocalArtifactText(source);
  const metadata = parsePublicationMetadata(content);
  return <section className="publish-metadata-summary"><header><div><h4>发布元数据</h4><span>{artifactName(artifact.relative_path)}</span></div><OpenLocalArtifactButton artifact={artifact} onOpenArtifact={onOpenArtifact} /></header>{error ? <p className="publish-material-preview-error">{error}</p> : metadata ? <div className="publish-metadata-grid"><div><span>标题</span><strong>{metadata.title || "未填写"}</strong></div><div><span>Tags</span><strong>{metadata.tags.length ? metadata.tags.join("、") : "未填写"}</strong></div><div className="publish-metadata-description"><span>简介</span><p>{metadata.description || "未填写"}</p></div></div> : <p className="publish-material-loading">{content ? "元数据格式无法摘要展示，请点击本地打开查看。" : "正在读取元数据…"}</p>}</section>;
}

function PublishVisualMaterialCard({ artifact, label, onOpenArtifact }: { artifact: Artifact | null; label: string; onOpenArtifact: (artifact: Artifact) => Promise<void> }) {
  if (!artifact) return <article className="publish-visual-material-card"><header><h4>{label}</h4><span className="publish-material-missing">未索引</span></header></article>;
  const kind = artifactPreviewKind(artifact.relative_path);
  return <article className="publish-visual-material-card"><header><div><h4>{label}</h4><span>{artifactName(artifact.relative_path)}</span></div><OpenLocalArtifactButton artifact={artifact} onOpenArtifact={onOpenArtifact} /></header>{kind ? <PublishMaterialPreview artifact={artifact} kind={kind} label={label} /> : <p className="publish-material-preview-error">该文件暂不支持预览。</p>}</article>;
}

function PublishStructuredMaterialCard({ artifact, label, onOpenArtifact }: { artifact: Artifact; label: string; onOpenArtifact: (artifact: Artifact) => Promise<void> }) {
  return <article className="publish-structured-material"><div><strong>{label}</strong><span>{artifactName(artifact.relative_path)}</span></div><OpenLocalArtifactButton artifact={artifact} onOpenArtifact={onOpenArtifact} /></article>;
}

function PublishMaterialPreview({ artifact, kind, label }: { artifact: Artifact; kind: "image" | "video" | "audio"; label: string }) {
  const source = localArtifactUrl(artifact.episode_id, artifact.relative_path, artifact.sha256);
  const { error, url } = useLocalArtifactBlob(source);
  const [isExpanded, setIsExpanded] = useState(false);
  if (error) return <div aria-label={`${label}预览`} className="publish-material-preview"><span className="publish-material-preview-error">{error}</span></div>;
  if (!url) return <div aria-label={`${label}预览`} className="publish-material-preview"><span>正在加载预览…</span></div>;
  const media = kind === "image" ? <img alt={`${label}预览`} src={url} /> : kind === "video" ? <video aria-label={`${label}预览`} controls preload="metadata" src={url} /> : <audio aria-label={`${label}预览`} controls preload="metadata" src={url} />;
  return <><figure className="publish-material-preview"><div>{media}</div><button aria-label={`放大查看${label}`} className="publish-material-zoom" onClick={() => setIsExpanded(true)} type="button">放大查看</button></figure>{isExpanded ? <div aria-label={`${label}放大预览`} aria-modal="true" className="publish-material-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsExpanded(false); }} role="dialog"><div><button aria-label={`关闭${label}放大预览`} className="publish-material-lightbox-close" onClick={() => setIsExpanded(false)} type="button">关闭</button>{media}</div></div> : null}</>;
}

function OpenLocalArtifactButton({ artifact, onOpenArtifact }: { artifact: Artifact; onOpenArtifact: (artifact: Artifact) => Promise<void> }) {
  const [isOpening, setIsOpening] = useState(false);
  async function openArtifact() {
    setIsOpening(true);
    try {
      await onOpenArtifact(artifact);
    } finally {
      setIsOpening(false);
    }
  }
  return <button className="publish-local-open" disabled={isOpening} onClick={() => void openArtifact()} type="button">{isOpening ? "打开中…" : "在本地打开"}</button>;
}

function parsePublicationMetadata(content: string): { description: string; tags: string[]; title: string } | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (!value || Array.isArray(value) || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title : "";
    const description = typeof record.description === "string" ? record.description : typeof record.desc === "string" ? record.desc : "";
    const tagsValue = record.tags ?? record.hashtags ?? record.tag;
    const tags = Array.isArray(tagsValue) ? tagsValue.filter((tag): tag is string => typeof tag === "string") : typeof tagsValue === "string" ? tagsValue.split(/[，,\s]+/).filter(Boolean) : [];
    return { description, tags, title };
  } catch {
    return null;
  }
}

function artifactName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function formatPublicationDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
