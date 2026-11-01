import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {TextAreaBase} from '../ui/dan-ui/components/base/textarea/textarea';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {isVideoProvider,videoProviders} from "../worker/videoProviderCatalog";
import { useEffect, useState } from "react";
import type { Database } from "../lib/database.types";
import { localCommand } from "../local-app/client";

type Material = Database["public"]["Tables"]["production_material_revisions"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function videoConfig(blueprint: unknown, shotType: string) { return record(record(blueprint)[shotType]); }

export function WanShotGenerator({ collapsible=false,blueprint, episodeId, reviewPackageId, shot, materials,  tasks, onRefresh }: {
  blueprint: unknown; episodeId: string; reviewPackageId: string;
  shot: { id: string; shotType: string; productionMethod: string };
  materials: Material[]; tasks: Task[]; onRefresh: () => Promise<void>;
  collapsible?:boolean;
}) {
  const config = videoConfig(blueprint, shot.shotType);
  const provider=String(record(config.executor).provider??""),official=isVideoProvider(provider),definition=official?videoProviders[provider]:null;
  const enabled = (provider === "bailian" || official) && config.execution_path === "external";
  const [reservation,setReservation]=useState("");
  const [imageId, setImageId] = useState("");
  const [prompt, setPrompt] = useState(shot.productionMethod);
  const [duration, setDuration] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState("");
  const candidates = tasks.filter((task) => task.provider === provider && record(record(task.input_snapshot).shot).id === shot.id && record(task.input_snapshot).storyboard_review_package_id === reviewPackageId);
  const latest = candidates.find((task) => task.id === activeId) ?? candidates.reduce<Task | undefined>((current, task) => !current || task.created_at > current.created_at ? task : current, undefined);
  const running = Boolean(activeId && !latest || latest && ["ready", "running"].includes(latest.status));
  useEffect(() => { if (!enabled || !running) return; const timer = setInterval(() => { void onRefresh().catch(() => {}); }, 2500); return () => clearInterval(timer); }, [enabled, running, onRefresh]);
  if (!enabled) return null;

  async function generate() {
    setBusy(true); setError("");
    try {
      if (!imageId || !prompt.trim()) throw new Error("请选择首帧并填写镜头动作。");
      const task = await localCommand<{id:string}>(official?"generateOfficialVideo":"generateWan", { ...(official?{reservationCents:Math.round(Number(reservation)*100)}:{}),episodeId, reviewPackageId, shotId: shot.id, firstFrameId: imageId, prompt: prompt.trim(), durationSeconds: duration }, undefined, "episode-commands");
      setActiveId(task.id); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法生成镜头。"); }
    finally { setBusy(false); }
  }
  async function resume() {
    if (!latest) return;
    setBusy(true); setError("");
    try {
      const task = await localCommand<{id:string}>("resumeWan", {episodeId,taskId:latest.id}, undefined, "episode-commands");
      setActiveId(task.id); await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法恢复查询。"); }
    finally { setBusy(false); }
  }
  const body=<section className="shot-content-section lc-video-generation" aria-label={`${shot.id} AI 视频生成`}>
    <h4>{shot.id} · {definition?.label??"万相"} AI 视频</h4>
    <label>首帧图片<NativeSelect size="sm" aria-label={`${shot.id} AI 首帧`} disabled={busy || running} onChange={(event) => setImageId(event.target.value)} value={imageId}><option value="">选择本期已上传图片</option>{materials.filter((material) => material.material_type === "image" && (!official || ["image/png","image/jpeg"].includes(material.mime_type))).map((material) => <option key={material.id} value={material.id}>{material.source_path}</option>)}</NativeSelect></label>
    <label>画面与动作<TextAreaBase size="sm" aria-label={`${shot.id} AI 动作`} maxLength={1500} disabled={busy || running} onChange={(event) => setPrompt(event.target.value)} value={prompt} rows={2} /></label>
    <label>时长（秒）<InputBase size="sm" aria-label={`${shot.id} AI 时长`} type="number" min={definition?.minDuration??2} max={15} step={1} value={duration} isDisabled={busy || running} onChange={(event) => setDuration(Number(event.target.value))} /></label>
    {official?<label>本次费用预留（元）<InputBase size="sm" aria-label={`${shot.id} 本次费用预留`} type="number" min="0.01" max="1000" step="0.01" value={reservation} isDisabled={busy||running} onChange={e=>setReservation(e.target.value)}/><small>按供应商控制台报价填写，这不是供应商账单。</small></label>:<p>720P · 无声 · 预计 ¥{(duration * 0.15).toFixed(2)}，为本次费用预留。</p>}
    <Button size="sm" color="secondary" className="button button-secondary" isDisabled={busy || running || !imageId || !prompt.trim() || !Number.isInteger(duration) || duration < (definition?.minDuration??2) || duration > 15 || official && (!Number.isFinite(Number(reservation)) || Number(reservation)<=0 || Number(reservation)>1000)} onClick={() => void generate()} type="button">{running ? "视频生成中…" : latest?.status === "completed" ? "重新生成 AI 视频" : "生成 AI 视频"}</Button>
    {latest && ["failed", "blocked"].includes(latest.status) ? <Button size="sm" color="secondary" className="button button-secondary" isDisabled={busy} onClick={() => void resume()} type="button">恢复原任务查询</Button> : null}
    {latest?.status === "completed" ? <p role="status">视频已加入本期原片列表，可在下方“当前原片”选择并裁剪。</p> : null}
    {latest && ["failed", "blocked"].includes(latest.status) ? <p role="alert">生成未完成。恢复查询会沿用已保存的供应商任务；提交结果未知时将停止，避免重复收费。</p> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
  </section>;
  return collapsible?<Disclosure label="AI 视频生成" meta={running?"生成中":latest&&["failed","blocked"].includes(latest.status)?"需处理":undefined} open={running||Boolean(latest&&["failed","blocked"].includes(latest.status))} className="production-node-section production-ai-generator">{body}</Disclosure>:body;
}
