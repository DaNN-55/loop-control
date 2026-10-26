import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NotificationCursor } from "./notificationPolicy.js";
import type { ClaimedNotificationEvent, NotificationDelivery } from "./notificationConsumer.js";
export function notificationDelivery(credentials: { url: string; serviceRoleKey: string }, directory: string): NotificationDelivery & { unresolved: () => Promise<number> } {
  const headers = { apikey: credentials.serviceRoleKey, Authorization: `Bearer ${credentials.serviceRoleKey}`, "Content-Type": "application/json" };
  async function rpc(name: string, body: object): Promise<unknown> {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, credentials.url), { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) throw Error(`提醒持久状态请求失败：HTTP ${response.status}`);
    return response.json();
  }
  return {
    async initialize() {
      let cursor: NotificationCursor | null = null;
      try {
        cursor = JSON.parse(await readFile(join(directory, "notifications-cursor.json"), "utf8"));
        if (!cursor || !Number.isFinite(Date.parse(cursor.createdAt)) || !/^[0-9a-f-]{36}$/i.test(cursor.id)) throw Error("旧提醒位置无效，拒绝重建。");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await rpc("initialize_notification_delivery", { p_after_time: cursor?.createdAt ?? null, p_after_id: cursor?.id ?? null });
    },
    async claim() {
      const rows = await rpc("claim_notification_event", {});
      if (!Array.isArray(rows) || rows.length > 1) throw Error("提醒领取返回格式无效。");
      if (!rows.length) return null;
      const row = rows[0];
      if (typeof row.id !== "string" || typeof row.delivery_token !== "string" || typeof row.created_at !== "string" || typeof row.event_type !== "string") throw Error("提醒领取返回事件无效。");
      return { id: row.id, deliveryToken: row.delivery_token, createdAt: row.created_at, eventType: row.event_type, payload: row.payload };
    },
    async finish(event: ClaimedNotificationEvent, outcome: "accepted" | "skipped" | "uncertain") {
      if (await rpc("finish_notification_delivery", { p_event_id: event.id, p_delivery_token: event.deliveryToken, p_outcome: outcome }) !== true) throw Error("提醒完成令牌失效，结果未确认。");
    },
    async unresolved() {
      const endpoint = new URL("/rest/v1/notification_delivery_events?select=event_id&outcome=in.(reserved,uncertain)", credentials.url);
      const response = await fetch(endpoint, { method: "HEAD", headers: { ...headers, Prefer: "count=exact" } });
      if (!response.ok) throw Error(`读取提醒未确认结果失败：HTTP ${response.status}`);
      const count = Number(response.headers.get("content-range")?.split("/").at(-1));
      if (!Number.isSafeInteger(count) || count < 0) throw Error("提醒未确认计数无效。");
      return count;
    },
  };
}
