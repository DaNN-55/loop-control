import {ProductionNodeSurface,ProductionNodePreview} from '../episodes/ProductionNodeLayout';
import {ModalOverlay,Modal,Dialog} from '../ui/dan-ui/components/application/modals/modal';
import {XClose} from '@untitledui/icons';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {TextAreaBase} from '../ui/dan-ui/components/base/textarea/textarea';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Expand,ExternalLink,Upload } from "lucide-react";
import type { Database } from "../lib/database.types";
import { artifactPreviewKind, localArtifactUrl, useLocalArtifactBlob, useLocalArtifactText } from "../reviews/localArtifactPreview";
import { useDialogFocus } from "../ui/useDialogFocus";

type Episode = Database["public"]["Tables"]["episodes"]["Row"];
type Artifact = Database["public"]["Tables"]["artifacts"]["Row"];

const artifactLabels: Record<string, string> = {
  cover: "封面",
  final_qc_report: "QC 报告",
  final_render: "视频",
  metadata: "发布元数据",
  publish_package: "发布包",
};

export function ProductionCompletionModal({ inline=false,isReadOnly=false,artifacts, episode, isPreparationPending, onClose, onOpenArtifact, onPrepare, publishVerification }: { inline?:boolean;isReadOnly?:boolean;artifacts: Artifact[]; episode: Episode; isPreparationPending: boolean; onClose: () => void; onOpenArtifact: (artifact: Artifact) => Promise<void>; onPrepare: (input: { cover: File; description: string; tags: string[]; title: string }) => Promise<boolean>; publishVerification: boolean }) {
  const dialogRef = useDialogFocus(!inline, onClose);
  const episodeArtifacts = artifacts.filter((artifact) => artifact.episode_id === episode.id);
  const metadataArtifact = episodeArtifacts.find((artifact) => artifact.artifact_type === "metadata") ?? null;
  const coverArtifact = episodeArtifacts.find((artifact) => artifact.artifact_type === "cover") ?? null;
  const videoArtifact = episodeArtifacts.find((artifact) => artifact.artifact_type === "final_render") ?? null;
  const publishPackageArtifact = episodeArtifacts.find((artifact) => artifact.artifact_type === "publish_package") ?? null;
  const isPublishPackageReady = Boolean(publishPackageArtifact && metadataArtifact && coverArtifact);
  const extraArtifacts = [publishPackageArtifact, episodeArtifacts.find((artifact) => artifact.artifact_type === "final_qc_report")].filter((artifact): artifact is Artifact => Boolean(artifact));
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

  const preparationLock=useRef(false);
  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(isReadOnly||isPreparationPending||preparationLock.current)return;preparationLock.current=true;
    try {
      setPreparationError("");
      if (!cover) throw new Error("请选择封面。");
      if (!(["image/jpeg", "image/png", "image/webp"].includes(cover.type) || /\.(jpe?g|png|webp)$/i.test(cover.name))) throw new Error("封面仅支持 JPG、PNG 或 WebP。");
      if (cover.size > 20 * 1024 * 1024) throw new Error("封面不能超过 20 MB。");
      if(!await onPrepare({ cover, description: publishDescription, tags: publishTags.split(/[，,\n]+/).map((tag) => tag.trim()).filter(Boolean), title: publishTitle.trim() }))throw new Error("发布包尚未生成，请检查错误后重试。");
    } catch (error) {
      setPreparationError(error instanceof Error ? error.message : "无法生成发布包。");
    }finally{preparationLock.current=false;}
  }

  if(inline)return <ProductionNodeSurface className="production-node-delivery" preview={<ProductionNodePreview title="交付预览" version={isPublishPackageReady?'已生成':'待交付'}><div className="production-delivery-media"><PublishVisualMaterialCard artifact={videoArtifact} label="视频" onOpenArtifact={onOpenArtifact}/>{coverPreview?<article className="publish-visual-material-card"><header><h4>封面草稿</h4></header><img className="production-delivery-cover-draft" alt="封面草稿预览" src={coverPreview}/></article>:<PublishVisualMaterialCard artifact={coverArtifact} label="封面" onOpenArtifact={onOpenArtifact}/>}</div>{isPublishPackageReady?<PublishMetadataSummary artifact={metadataArtifact} onOpenArtifact={onOpenArtifact}/>:<div className="production-delivery-metadata"><h3>{publishTitle||'尚未填写标题'}</h3>{publishDescription&&<p>{publishDescription}</p>}<dl><div><dt>标签</dt><dd>{publishTags||'尚未填写'}</dd></div><div><dt>交付状态</dt><dd>{isReadOnly?'流程尚未到达交付':'待生成并校验发布包'}</dd></div></dl></div>}</ProductionNodePreview>} actions={<><section className="production-node-section"><h4>交付文件</h4><ul className="production-delivery-files">{[videoArtifact,coverArtifact,metadataArtifact,...extraArtifacts].filter((a):a is Artifact=>Boolean(a)).map(a=><li key={a.id}><button type="button" aria-label={"打开 "+artifactName(a.relative_path)} title={a.relative_path} onClick={()=>void onOpenArtifact(a)}><span>{artifactLabels[a.artifact_type]??a.artifact_type}</span><span className="production-delivery-filename">{artifactName(a.relative_path)}</span><ExternalLink size={14} aria-hidden="true"/></button></li>)}</ul>{!episodeArtifacts.some(a=>['final_render','cover','metadata','publish_package'].includes(a.artifact_type))&&<p className="muted-copy">交付文件尚未生成。</p>}</section>{!isPublishPackageReady?<form className="production-node-section production-delivery-form" onSubmit={event=>void prepare(event)}><fieldset disabled={isReadOnly||isPreparationPending}><label>发布标题<InputBase size="sm" aria-label="发布标题" maxLength={200} onChange={event=>setPublishTitle(event.target.value)} isRequired value={publishTitle}/></label><label>标签<InputBase size="sm" aria-label="发布标签" onChange={event=>setPublishTags(event.target.value)} placeholder="用逗号分隔" value={publishTags}/></label><label className="production-delivery-full">简介<TextAreaBase size="sm" aria-label="发布简介" maxLength={5000} rows={3} onChange={event=>setPublishDescription(event.target.value)} value={publishDescription}/></label><label className="material-unified-upload production-delivery-full"><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" aria-label="选择封面" className="material-slot-input" onChange={event=>setCover(event.target.files?.[0]??null)} required type="file"/><Upload size={18}/><span>选择封面<small>JPG、PNG、WebP · 最大 20 MB</small></span></label>{preparationError&&<p role="alert" className="form-error production-delivery-full">{preparationError}</p>}<Button className="production-delivery-full" size="sm" color="primary" type="submit" isDisabled={isReadOnly||isPreparationPending||!cover||!publishTitle.trim()}>{isPreparationPending?'正在生成…':'生成发布包并完成生产'}</Button></fieldset></form>:<p className="production-node-readonly">{publishVerification?'发布包校验通过，生产已完成。':'发布包已生成，等待校验。'}</p>}{isReadOnly&&<p className="production-node-readonly">可以回看资料；流程到达后开放交付操作。</p>}</>}/>;

  return <div aria-label="完成生产" aria-modal="true" className="modal-backdrop publish-modal-backdrop" ref={dialogRef} role="dialog">
    <section className="modal-card publish-modal-card lc-delivery-workspace">
      <header><div><h2>完成生产</h2><p>{episode.title || "未命名生产单"} · {episode.id.slice(0, 8)}</p></div><Button size="sm" color="tertiary" aria-label="关闭完成生产" className="icon-button" onClick={onClose} type="button"><XClose aria-hidden="true" width={20} height={20}/></Button></header>
      <div className="publish-modal-overview">
        <div><span>本地生产单目录</span><code>episodes/{episode.id}</code></div>
        <div><span>发布包</span><strong>{publishPackageArtifact ? "发布包已固定" : "缺少发布包"}</strong></div>
        <div><span>生产状态</span><strong className={publishVerification ? "publish-verification-passed" : "publish-verification-failed"}>{publishVerification ? "生产已完成" : "等待发布包校验"}</strong></div>
      </div>
      {!isPublishPackageReady ? <section className="publish-preparation-warning"><strong>最终生产材料尚未齐全</strong><p>填写交付元数据并选择封面，系统会生成发布包、完成校验并结束本生产单。</p><div className="publish-preparation-layout"><form className="publish-preparation-form" onSubmit={(event) => void prepare(event)}><label>发布标题<InputBase size="sm" aria-label="发布标题" maxLength={200} onChange={(event) => setPublishTitle(event.target.value)} isRequired value={publishTitle} /></label><label>发布标签<InputBase size="sm" aria-label="发布标签" onChange={(event) => setPublishTags(event.target.value)} placeholder="用逗号分隔，最多 20 个" value={publishTags} /></label><label className="publish-preparation-description">发布简介<TextAreaBase size="sm" aria-label="发布简介" maxLength={5000} onChange={(event) => setPublishDescription(event.target.value)} rows={3} value={publishDescription} /></label><div className={`publish-preparation-cover${coverPreview ? " has-preview" : ""}`}><label className="material-unified-upload"><input accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" aria-label="选择封面" className="material-slot-input" onChange={(event) => setCover(event.target.files?.[0] ?? null)} required type="file" /><Upload aria-hidden="true" className="icon" /><span><strong>封面（JPG、PNG、WebP）</strong><small>{cover ? `${cover.name} · ${(cover.size / 1024 / 1024).toFixed(1)} MB` : "点击选择封面，最大 20 MB"}</small></span></label>{coverPreview ? <figure className="publish-selected-cover-preview"><img alt="所选封面预览" src={coverPreview} /><figcaption>封面预览</figcaption></figure> : null}</div>{preparationError ? <p className="form-error">{preparationError}</p> : null}<Button size="sm" color="primary" className="button button-primary" isDisabled={isPreparationPending || !cover || !publishTitle.trim()} type="submit">{isPreparationPending ? "生成中…" : "生成发布包并完成生产"}</Button></form><div className="publish-preparation-video"><PublishVisualMaterialCard artifact={videoArtifact} label="最终视频" onOpenArtifact={onOpenArtifact} /></div></div></section> : null}
      {isPublishPackageReady ? <section className="publish-materials"><header><div><h3>最终生产材料</h3><p>生产单在发布包校验通过后结束；外部发布不在本工作台记录。</p></div></header><PublishMetadataSummary artifact={metadataArtifact} onOpenArtifact={onOpenArtifact} /><div className="publish-visual-material-grid"><PublishVisualMaterialCard artifact={coverArtifact} label="封面" onOpenArtifact={onOpenArtifact} /><PublishVisualMaterialCard artifact={videoArtifact} label="视频" onOpenArtifact={onOpenArtifact} /></div>{extraArtifacts.length ? <Disclosure label={<>更多材料 <span>QC 报告 · 发布包</span></>} className="publish-extra-materials"><div className="publish-extra-material-list">{extraArtifacts.map((artifact) => <PublishStructuredMaterialCard artifact={artifact} key={artifact.id} label={artifactLabels[artifact.artifact_type] ?? artifact.artifact_type} onOpenArtifact={onOpenArtifact} />)}</div></Disclosure> : null}</section> : null}
      <div className="modal-actions"><Button size="sm" color="secondary" className="button button-secondary" onClick={onClose} type="button">关闭</Button></div>
    </section>
  </div>;
}

function PublishMetadataSummary({ artifact, onOpenArtifact }: { artifact: Artifact | null; onOpenArtifact: (artifact: Artifact) => Promise<void> }) {
  if (!artifact) return <section className="publish-metadata-summary"><header><h4>发布元数据</h4><span className="publish-material-missing">未索引</span></header></section>;
  const source = localArtifactUrl(artifact.episode_id, artifact.relative_path, artifact.sha256);
  const { content, error } = useLocalArtifactText(source);
  const metadata = parsePublicationMetadata(content);
  return <section className="publish-metadata-summary"><header><div><h4>发布元数据</h4><span>{artifactName(artifact.relative_path)}</span></div><OpenLocalArtifactButton artifact={artifact} onOpenArtifact={onOpenArtifact} /></header>{error ? <p className="publish-material-preview-error">{error}</p> : metadata ? <div className="publish-metadata-grid"><div><span>标题</span><strong>{metadata.title || "未填写"}</strong></div><div><span>标签</span><strong>{metadata.tags.length ? metadata.tags.join("、") : "未填写"}</strong></div><div className="publish-metadata-description"><span>简介</span><p>{metadata.description || "未填写"}</p></div></div> : <p className="publish-material-loading">{content ? "元数据格式无法摘要展示，请点击本地打开查看。" : "正在读取元数据…"}</p>}</section>;
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
  return <><figure className="publish-material-preview"><div>{media}</div><Button size="sm" color="tertiary" aria-label={`放大查看${label}`} className="publish-material-zoom" onClick={() => setIsExpanded(true)} type="button"><Expand size={16}/></Button></figure>{isExpanded ? <ModalOverlay isOpen isDismissable onOpenChange={setIsExpanded} className="dan-ui product-ui artifact-lightbox-overlay"><Modal className="artifact-lightbox-modal"><Dialog aria-label={`${label}放大预览`} className="artifact-lightbox-content"><Button autoFocus size="sm" color="tertiary" aria-label={`关闭${label}放大预览`} className="publish-material-lightbox-close" onPress={() => setIsExpanded(false)} type="button">关闭</Button>{media}</Dialog></Modal></ModalOverlay> : null}</>;
}

function OpenLocalArtifactButton({ artifact, onOpenArtifact }: { artifact: Artifact; onOpenArtifact: (artifact: Artifact) => Promise<void> }) {
  const [isOpening, setIsOpening] = useState(false);
  async function openArtifact() { setIsOpening(true); try { await onOpenArtifact(artifact); } finally { setIsOpening(false); } }
  return <Button size="sm" color="tertiary" className="publish-local-open" isDisabled={isOpening} onClick={() => void openArtifact()} type="button">{isOpening ? "打开中…" : "在本地打开"}</Button>;
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
  } catch { return null; }
}

function artifactName(path: string): string { return path.split(/[\\/]/).pop() || path; }
