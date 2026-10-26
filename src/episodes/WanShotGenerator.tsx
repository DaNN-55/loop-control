import { useEffect, useRef, useState } from "react";
import type { Database } from "../lib/database.types";
import { supabase } from "../lib/supabase";

type Material = Database["public"]["Tables"]["production_material_revisions"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function WanShotGenerator({ blueprint, episodeId, reviewPackageId, shot, materials, tasks, onRefresh }: {
  blueprint: unknown; episodeId: string; reviewPackageId: string;
  shot: { id: string; shotType: string; productionMethod: string };
  materials: Material[]; tasks: Task[]; onRefresh: () => Promise<void>;
}) {
  const config = record(record(blueprint)[shot.shotType]);
  const enabled = record(config.executor).provider === "bailian" && config.execution_path === "external";
  const [imageId, setImageId] = useState("");
  const [prompt, setPrompt] = useState(shot.productionMethod);
  const [duration, setDuration] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const candidates = tasks.filter((task) => task.provider === "bailian" && record(record(task.input_snapshot).shot).id === shot.id && record(task.input_snapshot).storyboard_review_package_id === reviewPackageId);
  const latest = candidates.find((task) => task.id === activeId) ?? candidates.reduce<Task | undefined>((current, task) => !current || task.created_at > current.created_at ? task : current, undefined);
  const running = Boolean(activeId && !latest || latest && ["ready", "running"].includes(latest.status));
  useEffect(() => { if (!enabled || !running) return; const timer = setInterval(() => { void onRefresh().catch(() => {}); }, 2500); return () => clearInterval(timer); }, [enabled, running, onRefresh]);
  if (!enabled) return null;

  async function dispatch(taskId: string) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new Error("请先登录 Owner。");
    const response = await fetch(`/_episode-dispatch?episode=${encodeURIComponent(episodeId)}&task=${encodeURIComponent(taskId)}`, { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
    if (!response.ok) throw new Error("任务已保存，但即时派发失败；可再次点击继续派发同一任务。");
    setActiveId(taskId); await onRefresh();
  }
  async function generate() {
    setBusy(true); setError("");
    try {
      if (!imageId || !prompt.trim()) throw new Error("请选择首帧并填写镜头动作。");
      if (latest?.status === "completed") requestId.current = crypto.randomUUID();
      const { data, error } = await supabase.rpc("request_wan_shot_video", { p_episode_id: episodeId, p_review_package_id: reviewPackageId, p_shot_id: shot.id, p_first_frame_id: imageId, p_prompt: prompt.trim(), p_duration: duration, p_request_id: requestId.current });
      if (error) throw new Error(error.message);
      await dispatch(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法生成镜头。"); }
    finally { setBusy(false); }
  }
  async function resume() {
    if (!latest) return;
    setBusy(true); setError("");
    try {
      const { error } = await supabase.rpc("resume_wan_video_task", { p_task_id: latest.id });
      if (error) throw new Error(error.message);
      await dispatch(latest.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法恢复查询。"); }
    finally { setBusy(false); }
  }
  return <section className="shot-content-section" aria-label={`${shot.id} AI 视频生成`}>
    <h4>{shot.id} · 万相 AI 视频</h4>
    <label>首帧图片<select aria-label={`${shot.id} AI 首帧`} disabled={busy || running} onChange={(event) => setImageId(event.target.value)} value={imageId}><option value="">选择本期已上传图片</option>{materials.filter((material) => material.material_type === "image").map((material) => <option key={material.id} value={material.id}>{material.source_path}</option>)}</select></label>
    <label>画面与动作<textarea aria-label={`${shot.id} AI 动作`} maxLength={1500} disabled={busy || running} onChange={(event) => setPrompt(event.target.value)} value={prompt} rows={2} /></label>
    <label>时长（秒）<input aria-label={`${shot.id} AI 时长`} type="number" min={2} max={15} step={1} value={duration} disabled={busy || running} onChange={(event) => setDuration(Number(event.target.value))} /></label>
    <p>720P · 无声 · 预计 ¥{(duration * 0.15).toFixed(2)}，计入已批准的调用预算。</p>
    <button className="button button-secondary" disabled={busy || running || !imageId || !prompt.trim() || !Number.isInteger(duration) || duration < 2 || duration > 15} onClick={() => void generate()} type="button">{running ? "视频生成中…" : latest?.status === "completed" ? "重新生成 AI 视频" : "生成 AI 视频"}</button>
    {latest && ["failed", "blocked"].includes(latest.status) ? <button className="button button-secondary" disabled={busy} onClick={() => void resume()} type="button">恢复原任务查询</button> : null}
    {latest?.status === "completed" ? <p role="status">视频已加入本期原片列表，可在下方“当前原片”选择并裁剪。</p> : null}
    {latest && ["failed", "blocked"].includes(latest.status) ? <p role="alert">生成未完成。恢复查询会沿用已保存的供应商任务；提交结果未知时将停止，避免重复收费。</p> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
  </section>;
}
