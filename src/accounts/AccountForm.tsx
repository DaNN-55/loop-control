import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Json } from "../lib/database.types";
import { defaultBlueprintPolicy } from "../platform/blueprintPolicy";
export const timezoneOptions = [
  ["Asia/Shanghai", "中国大陆 · 上海"],
  ["Asia/Ho_Chi_Minh", "越南 · 胡志明市"],
  ["Asia/Tokyo", "日本 · 东京"],
  ["Asia/Seoul", "韩国 · 首尔"],
  ["Asia/Singapore", "新加坡"],
  ["Asia/Kolkata", "印度 · 加尔各答"],
  ["Asia/Dubai", "阿联酋 · 迪拜"],
  ["Europe/London", "英国 · 伦敦"],
  ["Europe/Berlin", "德国 · 柏林"],
  ["Europe/Paris", "法国 · 巴黎"],
  ["America/New_York", "美国东部 · 纽约"],
  ["America/Chicago", "美国中部 · 芝加哥"],
  ["America/Denver", "美国山地 · 丹佛"],
  ["America/Los_Angeles", "美国西部 · 洛杉矶"],
  ["America/Toronto", "加拿大 · 多伦多"],
  ["Australia/Sydney", "澳大利亚 · 悉尼"],
  ["Pacific/Auckland", "新西兰 · 奥克兰"],
  ["UTC", "协调世界时 · UTC"],
] as const;

export function TimezoneSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label>时区<select aria-label="时区" onChange={(event) => onChange(event.target.value)} value={value}>{timezoneOptions.map(([timezone, label]) => <option key={timezone} value={timezone}>{label}（{timezone}）</option>)}</select></label>;
}

export function AccountForm({ isPending, onClose, onSubmit }: { isPending: boolean; onClose: () => void; onSubmit: (input: { name: string; slug: string; timezone: string; policy: Json }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ name, slug, timezone, policy: defaultBlueprintPolicy });
  }

  return <div className="modal-backdrop" role="presentation"><form aria-label="新建账号" className="modal-card" onSubmit={submit}><header><div><h2>新建账号</h2></div><button aria-label="关闭新建账号" className="icon-button" onClick={onClose} type="button"><X aria-hidden="true" className="icon" strokeWidth={1.8} /></button></header><label>账号名称<input autoFocus onChange={(event) => setName(event.target.value)} placeholder="例如：内容工作室" required value={name} /></label><label>账号标识<input onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="content-studio" required value={slug} /></label><TimezoneSelect onChange={setTimezone} value={timezone} /><p className="form-hint">选择账号日常运营和任务时间所使用的时区。</p><div className="modal-actions"><button className="button button-secondary" onClick={onClose} type="button">取消</button><button className="button button-primary" disabled={isPending} type="submit">{isPending ? "创建中…" : "创建账号"}</button></div></form></div>;
}

