import {Checkbox} from '../ui/dan-ui/components/base/checkbox/checkbox';
import {Disclosure} from '../ui/dan-ui/components/base/disclosure/disclosure';
import {TextAreaBase} from '../ui/dan-ui/components/base/textarea/textarea';
import {NativeSelect} from '../ui/dan-ui/components/base/select/select-native';
import {Button} from '../ui/dan-ui/components/base/buttons/button';
import {InputBase} from '../ui/dan-ui/components/base/input/input';
import {isVideoProvider,videoProviders} from "../worker/videoProviderCatalog";
import { useEffect, useRef, useState } from "react";
import type { Database } from "../lib/database.types";
import { localCommand, localRequest } from "../local-app/client";

type Material = Database["public"]["Tables"]["production_material_revisions"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export type EpisodeVideoBudgetShot = { shotType: string; id?: string };
type VideoBudget = { trial_video_limit_cents: number; total_limit_cents: number; full_generation_enabled: boolean };
type BudgetSnapshot = { budget: VideoBudget | null; usedCents: number };

function videoConfig(blueprint: unknown, shotType: string) { return record(record(blueprint)[shotType]); }

function supportsEpisodeVideoBudget(blueprint: unknown, shots: EpisodeVideoBudgetShot[]) {
  return shots.some(({ shotType }) => {
    const config = videoConfig(blueprint, shotType);
    const provider = String(record(config.executor).provider ?? "");
    return config.execution_path === "external" && (provider === "bailian" || isVideoProvider(provider));
  });
}

export function EpisodeVideoBudget({ blueprint, episodeId, refreshKey = 0, revision, scopeLabel, shots, tasks = [] }: {
  blueprint: unknown;
  episodeId: string;
  refreshKey?: number;
  revision?: string | number;
  scopeLabel?: string;
  shots: EpisodeVideoBudgetShot[];
  tasks?: Task[];
}) {
  const enabled = supportsEpisodeVideoBudget(blueprint, shots);
  const [budget, setBudget] = useState<BudgetSnapshot>({ budget: null, usedCents: 0 });
  const [trial, setTrial] = useState(2), [total, setTotal] = useState(15), [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const budgetRequestId = useRef(0);
  const syncedEpisodeId = useRef<string | null>(null);
  const lifecycle = useRef({ episodeId, epoch: 0, mounted: true });
  const taskRevision = revision ?? tasks.map((task) => `${task.id}:${task.status}:${task.actual_cost_cents ?? ""}`).join("|");

  useEffect(() => {
    lifecycle.current.mounted = true;
    lifecycle.current.episodeId = episodeId;
    lifecycle.current.epoch += 1;
    budgetRequestId.current += 1;
    syncedEpisodeId.current = null;
    setBudget({ budget: null, usedCents: 0 });
    setTrial(2); setTotal(15); setFull(false);
    setBusy(false); setError("");
    const episodeEpoch = lifecycle.current.epoch;
    return () => {
      if (lifecycle.current.epoch === episodeEpoch) lifecycle.current.epoch += 1;
    };
  }, [episodeId]);

  useEffect(() => () => {
    lifecycle.current.mounted = false;
    lifecycle.current.epoch += 1;
    budgetRequestId.current += 1;
  }, []);

  async function readBudget(syncValues: boolean, isActive: () => boolean = () => lifecycle.current.mounted && lifecycle.current.episodeId === episodeId) {
    const requestId = ++budgetRequestId.current;
    const next: BudgetSnapshot = await localRequest(`wan-budget?episode=${encodeURIComponent(episodeId)}`);
    if (!isActive() || requestId !== budgetRequestId.current) return;
    setBudget(next);
    if (syncValues) {
      setTrial(next.budget ? next.budget.trial_video_limit_cents / 100 : 2);
      setTotal(next.budget ? next.budget.total_limit_cents / 100 : 15);
      setFull(next.budget?.full_generation_enabled ?? false);
      syncedEpisodeId.current = episodeId;
    }
  }

  useEffect(() => {
    if (!enabled || busy) return;
    const syncValues = syncedEpisodeId.current !== episodeId;
    let active = true;
    void readBudget(syncValues, () => active).catch(() => {
      if (active) setError("生成预算读取失败，请刷新。");
    });
    return () => { active = false; };
  }, [enabled, episodeId, refreshKey, taskRevision, busy]);

  useEffect(() => () => { budgetRequestId.current += 1; }, []);

  if (!enabled) return null;

  async function saveBudget() {
    const saveEpisodeId = episodeId;
    const saveEpoch = lifecycle.current.epoch;
    const isSaveActive = () => lifecycle.current.mounted && lifecycle.current.episodeId === saveEpisodeId && lifecycle.current.epoch === saveEpoch;
    if (!isSaveActive()) return;
    setBusy(true); setError("");
    try {
      await localCommand("setWanBudget", { episodeId, trialCents: Math.round(trial * 100), totalCents: Math.round(total * 100), full }, undefined, "episode-commands");
      if (!isSaveActive()) return;
      await readBudget(true, isSaveActive);
    } catch (cause) {
      if (isSaveActive()) setError(cause instanceof Error ? cause.message : "生成预算保存失败。");
    } finally { if (isSaveActive()) setBusy(false); }
  }

  const labelPrefix = scopeLabel ? `${scopeLabel} ` : "视频 ";
  return <Disclosure className="episode-video-budget" label={<>生成预算{budget.budget ? ` · 已预留 ¥${(budget.usedCents / 100).toFixed(2)} / ¥${(budget.budget.total_limit_cents / 100).toFixed(2)}` : " · 尚未设置"}</>}>
    <div className="configuration-form">
      <label>试片上限（元）<InputBase size="sm" aria-label={`${labelPrefix}试片预算`} isDisabled={busy} type="number" min="0.01" max="1000" step="0.01" value={trial} onChange={e => setTrial(Number(e.target.value))} /></label>
      <label>总上限（元）<InputBase size="sm" aria-label={`${labelPrefix}总预算`} isDisabled={busy} type="number" min="0.01" max="1000" step="0.01" value={total} onChange={e => setTotal(Number(e.target.value))} /></label>
      <Checkbox className="configuration-check" isDisabled={busy} isSelected={full} onChange={setFull} label="允许在试片后继续生成" />
      <Button size="sm" color="secondary" type="button" className="button button-secondary" isDisabled={busy || !Number.isFinite(trial) || !Number.isFinite(total) || trial <= 0 || total < trial} onClick={() => void saveBudget()}>保存生成预算</Button>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div>
  </Disclosure>;
}

export function WanShotGenerator({ blueprint, episodeId, reviewPackageId, shot, materials, showBudget = true, tasks, onRefresh }: {
  blueprint: unknown; episodeId: string; reviewPackageId: string;
  shot: { id: string; shotType: string; productionMethod: string };
  materials: Material[]; tasks: Task[]; onRefresh: () => Promise<void>;
  showBudget?: boolean;
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
  const [budgetRefreshKey, setBudgetRefreshKey] = useState(0);
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
      setActiveId(task.id); await onRefresh(); setBudgetRefreshKey((current) => current + 1);
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
  return <section className="shot-content-section lc-video-generation" aria-label={`${shot.id} AI 视频生成`}>
    <h4>{shot.id} · {definition?.label??"万相"} AI 视频</h4>
    {showBudget ? <EpisodeVideoBudget blueprint={blueprint} episodeId={episodeId} refreshKey={budgetRefreshKey} scopeLabel={shot.id} shots={[shot]} tasks={tasks} /> : null}
    <label>首帧图片<NativeSelect size="sm" aria-label={`${shot.id} AI 首帧`} disabled={busy || running} onChange={(event) => setImageId(event.target.value)} value={imageId}><option value="">选择本期已上传图片</option>{materials.filter((material) => material.material_type === "image" && (!official || ["image/png","image/jpeg"].includes(material.mime_type))).map((material) => <option key={material.id} value={material.id}>{material.source_path}</option>)}</NativeSelect></label>
    <label>画面与动作<TextAreaBase size="sm" aria-label={`${shot.id} AI 动作`} maxLength={1500} disabled={busy || running} onChange={(event) => setPrompt(event.target.value)} value={prompt} rows={2} /></label>
    <label>时长（秒）<InputBase size="sm" aria-label={`${shot.id} AI 时长`} type="number" min={definition?.minDuration??2} max={15} step={1} value={duration} isDisabled={busy || running} onChange={(event) => setDuration(Number(event.target.value))} /></label>
    {official?<label>本次费用预留（元）<InputBase size="sm" aria-label={`${shot.id} 本次费用预留`} type="number" min="0.01" max="1000" step="0.01" value={reservation} isDisabled={busy||running} onChange={e=>setReservation(e.target.value)}/><small>按供应商控制台报价填写，计入账号预算；这不是供应商账单。</small></label>:<p>720P · 无声 · 预计 ¥{(duration * 0.15).toFixed(2)}，计入已批准的调用预算。</p>}
    <Button size="sm" color="secondary" className="button button-secondary" isDisabled={busy || running || !imageId || !prompt.trim() || !Number.isInteger(duration) || duration < (definition?.minDuration??2) || duration > 15 || official && (!Number.isFinite(Number(reservation)) || Number(reservation)<=0 || Number(reservation)>1000)} onClick={() => void generate()} type="button">{running ? "视频生成中…" : latest?.status === "completed" ? "重新生成 AI 视频" : "生成 AI 视频"}</Button>
    {latest && ["failed", "blocked"].includes(latest.status) ? <Button size="sm" color="secondary" className="button button-secondary" isDisabled={busy} onClick={() => void resume()} type="button">恢复原任务查询</Button> : null}
    {latest?.status === "completed" ? <p role="status">视频已加入本期原片列表，可在下方“当前原片”选择并裁剪。</p> : null}
    {latest && ["failed", "blocked"].includes(latest.status) ? <p role="alert">生成未完成。恢复查询会沿用已保存的供应商任务；提交结果未知时将停止，避免重复收费。</p> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
  </section>;
}
