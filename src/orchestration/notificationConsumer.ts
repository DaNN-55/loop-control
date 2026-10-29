import { collectNotifications, type AuditEvent } from "./notificationPolicy.js";
export interface ClaimedNotificationEvent extends AuditEvent { deliveryToken: string }
export interface EventNotification { eventId: string; title: string; body: string }
export interface NotificationDelivery {
  initialize: () => Promise<void>;
  claim: () => Promise<ClaimedNotificationEvent | null>;
  finish: (event: ClaimedNotificationEvent, outcome: "accepted" | "skipped" | "uncertain") => Promise<void>;
  enabled?: (event: ClaimedNotificationEvent) => Promise<boolean>;
}
export function notificationCategory(event:AuditEvent): 'review'|'failure'|'delivery'|null {
  if(event.eventType==='publish_package_verified')return 'delivery';
  if(event.eventType==='production_task_failed'||event.eventType==='connection_verification_failed'||/^(a_roll|b_roll|narration|soundtrack)_task_blocked$/.test(event.eventType))return 'failure';
  if(event.eventType==='pre_render_review_package_created')return 'review';
  const payload=event.payload as {to_stage?:unknown}|null;
  return event.eventType==='stage_transition'&&typeof payload?.to_stage==='string'&&payload.to_stage.endsWith('_review')?'review':null;
}
export async function consumeNotifications(delivery: NotificationDelivery, send: (notification: EventNotification) => Promise<void>): Promise<{ notifications: number; skipped: number }> {
  await delivery.initialize();
  let notifications = 0, skipped = 0;
  // Reservations are committed by the database before delivery. Concurrent and
  // restarted consumers never claim them again, even after an uncertain send.
  for (let count = 0; count < 1000; count++) {
    const event = await delivery.claim();
    if (!event) break;
    if(delivery.enabled&&!await delivery.enabled(event)){await delivery.finish(event,'skipped');skipped++;continue;}
    const selection = collectNotifications([event], { createdAt: "0001-01-01T00:00:00Z", id: "" });
    const special=event.eventType==='publish_package_verified'?{title:'交付包已完成',body:'交付包已通过验证，请在控制台查看。'}:event.eventType==='connection_verification_failed'?{title:'连接验证失败',body:'连接验证未通过，请在连接配置中查看。'}:event.eventType==='production_task_failed'?{title:'生产任务失败',body:'生产任务未完成，请在生产单中查看。'}:null;
    const message = special ?? [
      ...selection.approvalStages.map(stage => ({ title: "需要人工审批", body: `有 Episode 进入 ${stage}，请在控制台处理。` })),
      ...selection.stateStages.map(stage => ({ title: "Episode 状态已变更", body: `有 Episode 进入 ${stage}，请在控制台查看。` })),
      ...selection.blockerDetails.map(detail => ({ title: "媒体任务已阻塞", body: detail })),
    ][0];
    if (!message) { await delivery.finish(event, "skipped"); skipped++; continue; }
    try { await send({ eventId: event.id, ...message }); }
    catch {
      await delivery.finish(event, "uncertain");
      throw Error("提醒投递失败或结果未知；为避免重复不会自动重发。请核对控制台审核/阻塞队列。");
    }
    await delivery.finish(event, "accepted");
    notifications++;
  }
  return { notifications, skipped };
}
