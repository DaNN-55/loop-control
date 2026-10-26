import { expect, it, vi } from "vitest";
import { consumeNotifications, type ClaimedNotificationEvent } from "./notificationConsumer";
function fixture() {
 const queue:ClaimedNotificationEvent[]=[], outcomes:Record<string,string>={};
 const delivery={initialize:async()=>{},claim:async()=>queue.shift()??null,finish:async(event:ClaimedNotificationEvent,outcome:string)=>{outcomes[event.id]=outcome;}};
 return{queue,outcomes,delivery};
}
const event:ClaimedNotificationEvent={id:"event-1",deliveryToken:"token",createdAt:"2026-10-23T00:00:00Z",eventType:"stage_transition",payload:{to_stage:"script_review"}};
it("审核、状态和阻塞事件经同一消费入口发送，重复轮次不重发",async()=>{
 const f=fixture(),send=vi.fn(async()=>{});
 f.queue.push(event,{...event,id:"event-2",payload:{to_stage:"production_ready"}},{...event,id:"event-3",eventType:"b_roll_task_blocked",payload:{code:"missing",detail:"未配置"}});
 await consumeNotifications(f.delivery,send);await consumeNotifications(f.delivery,send);
 expect(send.mock.calls).toHaveLength(3);expect(f.outcomes).toEqual({"event-1":"accepted","event-2":"accepted","event-3":"accepted"});
});
it("部分投递失败保留未知结果，不把失败宣称已接受，也不重发已领取事件",async()=>{
 const f=fixture();f.queue.push(event,{...event,id:"event-2"});let accepted=0;
 await expect(consumeNotifications(f.delivery,async()=>{if(++accepted===2)throw Error("lost acknowledgement");})).rejects.toThrow("结果未知");
 expect(f.outcomes).toEqual({"event-1":"accepted","event-2":"uncertain"});
 const send=vi.fn(async()=>{});await consumeNotifications(f.delivery,send);expect(send).not.toHaveBeenCalled();
});
it("无有效提醒内容的事件标为跳过，避免将未投递记录当成功",async()=>{
 const f=fixture();f.queue.push({...event,payload:{}});const send=vi.fn(async()=>{});
 expect(await consumeNotifications(f.delivery,send)).toEqual({notifications:0,skipped:1});
 expect(f.outcomes).toEqual({"event-1":"skipped"});
});
