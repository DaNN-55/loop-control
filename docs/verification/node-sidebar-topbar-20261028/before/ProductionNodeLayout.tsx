import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Expand, FileText, GripVertical, ImageIcon, Pencil, Save, X } from 'lucide-react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '../ui/dan-ui/components/base/buttons/button';
import { MarkdownPreview } from '../ui/MarkdownPreview';
import { artifactPreviewKind, localArtifactUrl, useLocalArtifactBlob, useLocalArtifactText } from '../reviews/localArtifactPreview';
import { mainScriptDiagnostic } from '../reviews/mainScript';
import { isProductionScriptV2 } from '../reviews/productionScript';
import type { EpisodeStage } from '../platform/types';
import './production-nodes.css';
export const productionNodes = [
    { id: 'input', label: '输入与脚本', stages: ['waiting_input', 'brief_draft', 'script_draft', 'script_review'] },
    { id: 'visual', label: '视觉准备', stages: ['script_approved', 'visual_draft', 'visual_review', 'visual_approved'] },
    { id: 'storyboard', label: '分镜审核', stages: ['storyboard_draft', 'storyboard_review'] },
    { id: 'shots', label: '逐镜头制作', stages: ['storyboard_approved'] },
    { id: 'render', label: '预渲染审核', stages: ['production_ready', 'render_ready'] },
    { id: 'qc', label: '合成与 QC', stages: ['qc_review'] },
    { id: 'delivery', label: '交付', stages: ['qc_passed', 'production_completed'] },
] as const;
export type ProductionNodeId = typeof productionNodes[number]['id'];
export function nodeForStage(stage: EpisodeStage): ProductionNodeId { return productionNodes.find(n => (n.stages as readonly string[]).includes(stage))?.id ?? 'input'; }
export function ProductionNodeNavigation({ stage, selected, onSelect }: {
    stage: EpisodeStage;
    selected: ProductionNodeId;
    onSelect: (node: ProductionNodeId) => void;
}) {
    const current = productionNodes.findIndex(n => n.id === nodeForStage(stage));
    return <nav aria-label="生产工作流" className="production-node-navigation" role="tablist">{productionNodes.map((node, i) => {
            const complete = i < current || stage === 'production_completed' || node.id === 'visual' && stage === 'visual_approved';
            return <button key={node.id} type="button" role="tab" id={'production-node-tab-' + node.id} aria-controls={'production-node-panel-' + node.id} aria-selected={node.id === selected} tabIndex={node.id === selected ? 0 : -1} data-complete={complete || undefined} onClick={() => onSelect(node.id)} onKeyDown={event => { const target = event.key === 'ArrowRight' ? (i + 1) % 7 : event.key === 'ArrowLeft' ? (i + 6) % 7 : event.key === 'Home' ? 0 : event.key === 'End' ? 6 : -1; if (target < 0)
                return; event.preventDefault(); onSelect(productionNodes[target].id); document.getElementById('production-node-tab-' + productionNodes[target].id)?.focus(); }}><span className="production-node-marker" aria-hidden="true">{complete ? <Check size={12}/> : i + 1}</span><span><strong>{node.label}</strong><small>{complete ? '已完成' : i === current ? '当前阶段' : '待开始'}</small></span></button>;
        })}</nav>;
}
export function ProductionNodeSurface({ preview, actions, className = '' }: {
    preview: ReactNode;
    actions: ReactNode;
    className?: string;
}) { return <div className={'production-node-surface ' + className}><div className="production-node-preview-column">{preview}</div><aside className="production-node-actions" aria-label="本节点操作"><header><h3>本节点操作</h3></header>{actions}</aside></div>; }
export function ProductionNodePreview({ title, version, tools, children }: {
    title: string;
    version?: string | number;
    tools?: ReactNode;
    children: ReactNode;
}) {
    const [expanded, setExpanded] = useState(false);
    return <section className="production-node-preview"><header><div><h3>{title}</h3>{version !== undefined && <span className="production-node-version">{typeof version === 'number' ? 'v' + version : version}</span>}</div><div className="production-node-tools">{tools}<Button size="sm" color="tertiary" aria-label={'放大' + title} title="放大预览" iconLeading={Expand} onPress={() => setExpanded(true)}/></div></header>{!expanded && children}{expanded && <ModalOverlay isOpen isDismissable onOpenChange={setExpanded} className="dan-ui product-ui production-node-overlay"><Modal className="production-node-modal"><Dialog aria-label={title + '放大预览'}><header><h3>{title}</h3><Button size="sm" color="tertiary" aria-label="关闭放大预览" iconLeading={X} onPress={() => setExpanded(false)}/></header>{children}</Dialog></Modal></ModalOverlay>}</section>;
}
export function ProductionNodeEmpty({ text }: {
    text: string;
}) { return <div className="production-node-empty"><FileText size={24} aria-hidden="true"/><p>{text}</p></div>; }
export interface NodeMediaItem {
    key: string;
    label: string;
    source: string | null;
    kind: 'image' | 'video' | 'audio';
}
export function ProductionNodeMedia({ item }: {
    item: NodeMediaItem;
}) {
    const { url, error } = useLocalArtifactBlob(item.source);
    return <div className="production-node-media">{error ? <p role="alert" className="form-error">{error}</p> : !url ? <p role="status">正在读取预览…</p> : item.kind === 'image' ? <img alt={item.label} src={url}/> : item.kind === 'video' ? <video aria-label={item.label} controls preload="metadata" src={url}/> : <audio aria-label={item.label} controls src={url}/>}</div>;
}
export function ProductionNodeGallery({ items, title, version, details, frameless = false }: {
    items: NodeMediaItem[];
    title: string;
    version?: number;
    details?: ReactNode;
    frameless?: boolean;
}) {
    const [key, setKey] = useState('');
    const selected = items.find(i => i.key === key) ?? items[0];
    const body = <>{selected ? <><ProductionNodeMedia key={selected.key} item={selected}/>{items.length > 1 && <div className="production-node-reference-rail" aria-label="视觉参考选择">{items.map(item => <button type="button" key={item.key} aria-pressed={selected.key === item.key} onClick={() => setKey(item.key)}><NodeReferenceThumbnail item={item}/><span>{item.label}</span></button>)}</div>}</> : <ProductionNodeEmpty text="尚无可预览的图片或视频。"/>}{details}</>;
    return frameless ? body : <ProductionNodePreview title={title} version={version}>{body}</ProductionNodePreview>;
}
function NodeReferenceThumbnail({ item }: {
    item: NodeMediaItem;
}) { const { url } = useLocalArtifactBlob(item.kind === 'image' ? item.source : null); return url ? <img alt="" src={url} loading="lazy"/> : <ImageIcon size={24} aria-hidden="true"/>; }
export interface NodeShotItem {
    id: string;
    label: string;
    duration: number;
    thumbnail?: ReactNode;
    complete?: boolean;
}
export function ProductionShotRail({ shots, selected, onSelect, onReorder, onInsert, disabled = false }: {
    shots: NodeShotItem[];
    selected: string;
    onSelect: (id: string) => void;
    onReorder?: (ids: string[]) => void;
    onInsert?: () => void;
    disabled?: boolean;
}) {
    const drag = useRef(''), rail = useRef<HTMLDivElement>(null);
    function move(source: string, target: string) { if (disabled || !onReorder || source === target)
        return; const ids = shots.map(s => s.id), from = ids.indexOf(source), to = ids.indexOf(target); if (from < 0 || to < 0)
        return; ids.splice(from, 1); ids.splice(to, 0, source); onReorder(ids); }
    useEffect(() => { const current = rail.current?.querySelector<HTMLElement>('[aria-pressed="true"]'); if (!current || !rail.current)
        return; const r = rail.current.getBoundingClientRect(), s = current.getBoundingClientRect(); if (s.left < r.left)
        rail.current.scrollLeft -= r.left - s.left;
    else if (s.right > r.right)
        rail.current.scrollLeft += s.right - r.right; }, [selected, shots.map(s => s.id).join('\0')]);
    return <section className="production-shot-rail" aria-label="镜头顺序"><header><h4>镜头顺序 <span>{shots.length}</span></h4>{onInsert && <Button size="sm" color="tertiary" isDisabled={disabled} onPress={onInsert}>插入补充镜头</Button>}</header><div ref={rail} className="production-shot-track">{shots.map((shot, i) => <div className="production-shot-tile" key={shot.id} data-selected={shot.id === selected || undefined} onDragOver={event => { if (drag.current && !disabled)
        event.preventDefault(); }} onDrop={event => { event.preventDefault(); move(drag.current, shot.id); drag.current = ''; }}><div className="production-shot-tile-top"><span>{String(i + 1).padStart(2, '0')} · {shot.id}</span>{onReorder && <button type="button" draggable={!disabled} disabled={disabled} aria-label={'拖动 ' + shot.id + ' 调整顺序'} onDragStart={event => { drag.current = shot.id; event.dataTransfer.setData('text/plain', shot.id); }} onDragEnd={() => { drag.current = ''; }} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key))
        return; event.preventDefault(); const target = shots[i + (event.key === 'ArrowLeft' ? -1 : 1)]; if (target)
        move(shot.id, target.id); }}><GripVertical size={12}/></button>}</div><button className="production-shot-select" type="button" aria-label={'查看镜头 ' + shot.id} aria-pressed={selected === shot.id} onClick={() => onSelect(shot.id)}>{shot.thumbnail ?? <span className="production-shot-no-image"><ImageIcon size={20}/></span>}<strong>{shot.label}</strong><small>{shot.duration}s{shot.complete ? ' · 已确认' : ''}</small></button></div>)}</div></section>;
}
export interface NodeMaterialSource {
    name: string;
    type: string;
    file?: File;
    source?: string | null;
    version?: number;
    isMainScript?: boolean;
}
export function ProductionMaterialPreview({ material, onSave, onBack, isPending = false }: {
    material: NodeMaterialSource;
    onSave?: (text: string) => void;
    onBack?: () => void;
    isPending?: boolean;
}) {
    const script = material.type === 'script';
    const persisted = useLocalArtifactText(script && !material.file ? material.source ?? null : null);
    const [draftText, setDraftText] = useState(''), [draftUrl, setDraftUrl] = useState(''), [editing, setEditing] = useState(false), [text, setText] = useState(''), [error, setError] = useState(''), [issue, setIssue] = useState<{
        line: number;
        message: string;
    } | null>(null);
    const editor = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        let active = true;
        setEditing(false);
        setIssue(null);
        setError('');
        setDraftText('');
        setDraftUrl('');
        if (!material.file)
            return;
        if (script) {
            const reader = new FileReader();
            reader.onload = () => { if (active)
                setDraftText(String(reader.result ?? '')); };
            reader.onerror = () => { if (active)
                setError('脚本读取失败，请重新选择文件。'); };
            reader.readAsText(material.file);
            return () => { active = false; if (reader.readyState === FileReader.LOADING)
                reader.abort(); };
        }
        const url = URL.createObjectURL(material.file);
        setDraftUrl(url);
        return () => { active = false; URL.revokeObjectURL(url); };
    }, [material.file, material.source, script]);
    const content = material.file ? draftText : persisted.content;
    const readError = material.file ? error : error || persisted.error;
    function validate(value: string) { const message = material.isMainScript ? mainScriptDiagnostic(value) : null; if (!message)
        return null; const explicit = /第 (\d+) 行/.exec(message); const lines = value.split('\n'); let line = explicit ? Number(explicit[1]) : !/^#\s+\S+/m.test(value) ? 1 : Math.max(1, lines.findIndex(l => /^##\s+正文\s*$/.test(l)) + 1); return { line, message }; }
    function save() { const problem = validate(text); setIssue(problem); if (problem) {
        editor.current?.focus();
        return;
    } onSave?.(text); setEditing(false); setIssue(null); }
    function edit() { setText(content ?? ''); setIssue(null); setEditing(true); }
    const tools = <>{onBack && !editing && <Button size="sm" color="tertiary" aria-label="返回节点预览" title="返回节点预览" iconLeading={ArrowLeft} onPress={onBack}/>} {!editing && onSave ? <Button size="sm" color="tertiary" aria-label="修订主脚本" title="修订" iconLeading={Pencil} isDisabled={isPending} onPress={edit}/> : null}</>;
    const kind = artifactPreviewKind(material.name);
    const displayName = material.name.split(/[\\/]/).at(-1) ?? material.name;
    return <ProductionNodePreview title={script ? '脚本预览' : displayName} version={material.version ?? (material.file ? '待导入' : undefined)} tools={tools}>{script ? editing ? <div className="production-script-edit"><div className="production-script-code"><div className="production-script-line-numbers" aria-hidden="true">{text.split('\n').map((_, i) => <span key={i} data-error={issue?.line === i + 1 || undefined}>{i + 1}</span>)}</div><textarea ref={editor} aria-label="主脚本 Markdown 修订" aria-invalid={Boolean(issue)} aria-describedby={issue ? 'production-script-error' : undefined} value={text} style={issue ? { backgroundImage: `linear-gradient(to bottom,transparent ${(issue.line - 1) * 24}px,var(--lc-danger-soft) ${(issue.line - 1) * 24}px,var(--lc-danger-soft) ${issue.line * 24}px,transparent ${issue.line * 24}px)` } : undefined} spellCheck={false} rows={Math.max(12, text.split('\n').length + 1)} onChange={event => { setText(event.target.value); if (issue)
        setIssue(validate(event.target.value)); }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        save();
    } }}/></div>{issue && <button type="button" id="production-script-error" className="production-script-error" role="alert" onClick={() => { const offset = text.split('\n').slice(0, issue.line - 1).reduce((n, l) => n + l.length + 1, 0); editor.current?.focus(); editor.current?.setSelectionRange(offset, offset + (text.split('\n')[issue.line - 1]?.length ?? 0)); }}>第 {issue.line} 行 · {issue.message.replace(/^第 \d+ 行：/, '')}</button>}<footer><Button size="sm" color="secondary" onPress={() => { setEditing(false); setIssue(null); }}>取消</Button><Button size="sm" color="primary" iconLeading={Save} isDisabled={isPending} onPress={save}>保存修订</Button></footer></div> : readError ? <p role="alert" className="form-error">{readError}</p> : content ? <MarkdownPreview content={content}/> : <ProductionNodeEmpty text="正在读取脚本…"/> : draftUrl && kind ? <div className="production-node-media">{kind === 'image' ? <img src={draftUrl} alt={material.name}/> : kind === 'video' ? <video src={draftUrl} controls aria-label={material.name}/> : <audio controls src={draftUrl} aria-label={material.name}/>}</div> : kind && material.source ? <ProductionNodeMedia item={{ key: material.source, label: material.name, source: material.source, kind }}/> : <ProductionNodeEmpty text="此文件暂不支持直接预览。"/>}</ProductionNodePreview>;
}
export function nodeMediaItem(episodeId: string, path: string, sha: string, label = path): NodeMediaItem | null { const kind = artifactPreviewKind(path); return kind ? { key: path + sha, label, kind, source: localArtifactUrl(episodeId, path, sha) } : null; }
export function ProductionScriptPlanGate({ source, children }: {
    source: string | null;
    children: ReactNode;
}) { const { content } = useLocalArtifactText(source); return content && isProductionScriptV2(content) ? children : null; }
