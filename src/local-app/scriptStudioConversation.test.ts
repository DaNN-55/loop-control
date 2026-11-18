// @vitest-environment node
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {readStudioConversation} from './scriptStudioConversation';
import {localScriptStudioPlan} from '../scriptStudio';
const scope={episodeId:'episode',expectedScriptRevisionId:'revision',text:'雪山晨光。',targetDuration:15};
const plan=localScriptStudioPlan(scope.text,15);
const row=(id:string,previousRequestId:string|null,mode='optimize',instruction='')=>({id,owner_id:'owner',episode_id:'episode',script_revision_id:'revision',source_text:scope.text,status:'completed',result:mode==='discuss'?{requestId:id,status:'completed',message:'建议保留连续镜头。'}:{requestId:id,status:'completed',plan},request_snapshot:{version:'script-studio/v1',data:{targetDuration:15,mode,instruction,previousRequestId}}});
const client=(rows:unknown[])=>({query:vi.fn(async()=>({rows}))}) as unknown as PoolClient;
it('restores a chronological discussion and the latest valid plan without making a reply adoptable',async()=>{
 const c=client([row('talk','manual','discuss','节奏再慢一点？'),{...row('manual','plan'),request_snapshot:{version:'script-studio/v1',data:{targetDuration:15,mode:'optimize',previousRequestId:'plan'},manualEdit:{index:0}}},row('plan',null,'optimize','不要人物。')]);
 const value=await readStudioConversation(c,'owner',scope,'talk');
 expect(value.latestRequestId).toBe('talk');expect(value.latest?.message).toContain('连续镜头');expect(value.result?.requestId).toBe('manual');
 expect(value.turns.map(t=>t.requestId)).toEqual(['plan','manual','talk']);expect(value.conversation).toContainEqual({role:'user',content:'不要人物。'});expect(value.conversation.at(-2)).toEqual({role:'user',content:'节奏再慢一点？'});
});
it.each([{owner_id:'other'},{episode_id:'other'},{script_revision_id:'old'},{source_text:'另一份原文'},{request_snapshot:{version:'script-studio/v1',data:{targetDuration:20}}}])('rejects dialogue outside the exact Owner and source scope: %j',async patch=>{
 await expect(readStudioConversation(client([{...row('talk',null),...patch}]),'owner',scope,'talk')).rejects.toThrow(/上下文/);
});
it('keeps unknown outcomes visible and refuses a broken or cyclic parent chain',async()=>{
 const unknown={...row('unknown','plan'),status:'unknown',result:{requestId:'unknown',status:'unknown',message:'结果未知。'}};
 const value=await readStudioConversation(client([unknown,row('plan',null)]),'owner',scope,'unknown');expect(value.latest?.status).toBe('unknown');expect(value.result?.requestId).toBe('plan');
 await expect(readStudioConversation(client([row('bad','missing')]),'owner',scope,'bad')).rejects.toThrow(/上下文/);
 await expect(readStudioConversation(client([row('a','a')]),'owner',scope,'a')).rejects.toThrow(/上下文/);
});

it('restores per-shot edit markers from legacy manual receipts without changing the persisted plan',async()=>{
 const legacy={...row('manual','plan'),request_snapshot:{version:'script-studio/v1',data:{targetDuration:15,mode:'adapt',previousRequestId:'plan'},manualEdit:{index:0}}},c=client([legacy,row('plan',null)]),value=await readStudioConversation(c,'owner',scope,'manual');expect(value.result?.modifiedShotIndexes).toEqual([0]);expect(legacy.result).not.toHaveProperty('modifiedShotIndexes');
});

it('attributes each reply to its recorded model and keeps manual operations separate',async()=>{
 const first={...row('first',null),model:'gpt-6.1-sol',request_snapshot:{...row('first',null).request_snapshot,selection:{provider:'openai'}}},talk={...row('talk','first','discuss','换种思路？'),model:'deepseek-v4-pro',request_snapshot:{...row('talk','first','discuss').request_snapshot,selection:{provider:'deepseek'}}},manual={...row('manual','talk'),result:{requestId:'manual',status:'completed',plan,message:'手动修改已保存，仍需采用。'},request_snapshot:{version:'script-studio/v1',data:{targetDuration:15,mode:'adapt',previousRequestId:'talk'},manualEdit:{index:0}}};
 const value=await readStudioConversation(client([manual,talk,first]),'owner',scope,'manual');expect(value.turns[0]).toMatchObject({model:'gpt-6.1-sol',provider:'openai'});expect(value.turns[1]).toMatchObject({model:'deepseek-v4-pro',provider:'deepseek'});expect(value.turns[2]).not.toHaveProperty('model');expect(value.turns[2].answer).toBe('手动修改已保存，仍需采用。');
});

it('normalizes historical content revisions without exposing the retired mode or changing stored receipts',async()=>{
 const legacy={...row('old',null,'adapt','保留历史内容'),result:{requestId:'old',status:'completed',plan:{...plan,changes:['历史内容变化']}}},before=structuredClone(legacy);
 const value=await readStudioConversation(client([legacy]),'owner',scope,'old');
 expect(value.mode).toBe('revision');expect(value.turns[0].mode).toBe('revision');expect(value.turns[0].instruction).toBe('保留历史内容');expect(value.result?.plan?.changes).toEqual(['历史内容变化']);expect(legacy).toEqual(before);
});
it('restores current manual revision receipts and their parent conversation',async()=>{
 const manual={...row('manual','plan','revision'),request_snapshot:{version:'script-studio/v1',data:{targetDuration:15,mode:'revision',previousRequestId:'plan'},manualDelete:{index:0}},result:{requestId:'manual',status:'completed',plan:{...plan,changes:['手动删除']},message:'镜头已删除，仍需采用。'}};
 const value=await readStudioConversation(client([manual,row('plan',null,'optimize','固定机位')]),'owner',scope,'manual');
 expect(value.mode).toBe('revision');expect(value.turns[1].mode).toBe('edit');expect(value.conversation).toContainEqual({role:'user',content:'固定机位'});expect(value.turns[1].answer).toBe('镜头已删除，仍需采用。');
});

it('keeps an explicit empty conversation empty instead of finding the latest implicit receipt',async()=>{
 const explicit={...scope,conversationId:'11111111-1111-4111-8111-111111111111'};
 const c={query:vi.fn(async(sql:string)=>({rows:sql.includes('script_studio_conversations')?[{id:explicit.conversationId}]:[]}))} as unknown as PoolClient;
 const result=await readStudioConversation(c,'owner',explicit);expect(result.turns).toEqual([]);expect(result.result).toBeNull();
 expect(c.query).toHaveBeenCalledWith(expect.stringContaining('conversationId'),expect.arrayContaining([explicit.conversationId]));
});
it('refuses a parent from another conversation even when the script scope matches',async()=>{
 const explicit={...scope,conversationId:'11111111-1111-4111-8111-111111111111'};
 const c={query:vi.fn(async(sql:string)=>({rows:sql.includes('script_studio_conversations')?[{id:explicit.conversationId}]:[row('old',null)]}))} as unknown as PoolClient;
 await expect(readStudioConversation(c,'owner',explicit,'old')).rejects.toThrow(/对话/);
});
