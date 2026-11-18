// @vitest-environment node
import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {ownerTransaction} from './ownerTransaction';
import {createStudioConversation,listStudioConversations,assertStudioConversation,assertNoUnresolvedStudioRequest} from './scriptStudioSessions';
import {readStudioConversation} from './scriptStudioConversation';
import {localScriptStudioPlan} from '../scriptStudio';
const contextPath=process.env.LOOP_SCRIPT_STUDIO_TEST_CONTEXT;
let f:Awaited<ReturnType<typeof nativeWorkspaceFixture>>,episode:string,version:string;
const scope=(text='雪山晨光。')=>({episodeId:episode,expectedScriptRevisionId:null,text,targetDuration:15});
beforeAll(async()=>{
 if(!contextPath)return;const {runtimeContext}=await import(contextPath),context=runtimeContext();if(context.dailyRuntime!==false||!(context.isolatedFixtureContainer||context.isolatedFixtureNative&&context.nativeConnection))throw Error('Only explicitly isolated fixture');
 f=await nativeWorkspaceFixture({testContextModule:contextPath,migrations:['db/local/211-script-studio-conversations.sql']});
 const account=randomUUID(),connection=randomUUID();episode=randomUUID();version=randomUUID();
 await f.c.query('BEGIN');
 await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'Conversation fixture','Asia/Shanghai')",[account,'conversation-'+account]);
 await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[account,f.owner]);
 await f.c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy,is_active) VALUES($1,$1,1,'{}',true)",[account]);
 await f.c.query('UPDATE public.accounts SET current_blueprint_version_id=$1 WHERE id=$1',[account]);
 await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage) VALUES($1,$2,$2,'隔离会话验收','waiting_input')",[episode,account]);
 await f.c.query("INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint) VALUES($1,'openai','openai_responses','Conversation fixture',$2,$3,'https://api.openai.com/v1')",[connection,f.owner,version]);
 await f.c.query("INSERT INTO public.external_connection_versions(id,connection_id,version,vault_secret_id,provider,adapter,endpoint) VALUES($1,$2,1,$3,'openai','openai_responses','https://api.openai.com/v1')",[version,connection,randomUUID()]);
 await f.c.query('COMMIT');
},90000);
afterAll(async()=>{await f?.close();},90000);
async function receipt(text:string,status='completed',conversationId?:string,previousRequestId?:string){
 const id=randomUUID(),plan=localScriptStudioPlan(text,15);
 await f.c.query('INSERT INTO local_identity.script_format_requests(owner_id,id,episode_id,connection_version_id,model,payload_hash,source_text,diagnostic,request_snapshot,status,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[f.owner,id,episode,version,'gpt-5.6-luna',createHash('sha256').update(id).digest('hex'),text,'Isolated conversation receipt',{version:'script-studio/v1',data:{targetDuration:15,mode:'optimize',instruction:'不增加人物',...(conversationId?{conversationId}:{}),...(previousRequestId?{previousRequestId}:{})}},status,{requestId:id,status,plan}]);return id;
}
it.skipIf(!contextPath)('persists an empty new conversation with idempotent identity and exact Owner/source scope',async()=>{
 const s=scope('空会话。'),id=randomUUID();expect(await ownerTransaction(f.pool,f.owner,true,c=>listStudioConversations(c,f.owner,s))).toEqual([]);
 const a=await ownerTransaction(f.pool,f.owner,false,c=>createStudioConversation(c,f.owner,s,id)),b=await ownerTransaction(f.pool,f.owner,false,c=>createStudioConversation(c,f.owner,s,id));expect(a).toEqual(b);expect(a.number).toBe(1);
 const empty=await ownerTransaction(f.pool,f.owner,true,c=>readStudioConversation(c,f.owner,{...s,conversationId:id}));expect(empty.turns).toEqual([]);expect(empty.result).toBeNull();
 await expect(ownerTransaction(f.pool,f.other,true,c=>assertStudioConversation(c,f.other,{...s,conversationId:id}))).rejects.toThrow(/对话/);
 await expect(ownerTransaction(f.pool,f.owner,true,c=>assertStudioConversation(c,f.owner,{...s,targetDuration:16,conversationId:id}))).rejects.toThrow(/对话/);
 await expect(ownerTransaction(f.pool,f.owner,false,c=>createStudioConversation(c,f.owner,scope('不同原文。'),id))).rejects.toThrow(/上下文/);
});
it.skipIf(!contextPath)('keeps old receipts intact and isolates plans and parent chains between conversations',async()=>{
 const s=scope('旧会话与新会话。'),legacy=await receipt(s.text),id=randomUUID();
 const item=await ownerTransaction(f.pool,f.owner,false,c=>createStudioConversation(c,f.owner,s,id));expect(item.number).toBe(2);
 expect((await ownerTransaction(f.pool,f.owner,true,c=>readStudioConversation(c,f.owner,{...s,conversationId:id}))).turns).toEqual([]);
 const next=await receipt(s.text,'completed',id);const restored=await ownerTransaction(f.pool,f.owner,true,c=>readStudioConversation(c,f.owner,{...s,conversationId:id}));expect(restored.latestRequestId).toBe(next);expect(restored.turns).toHaveLength(1);
 await expect(ownerTransaction(f.pool,f.owner,true,c=>readStudioConversation(c,f.owner,{...s,conversationId:id},legacy))).rejects.toThrow(/对话/);
 expect((await ownerTransaction(f.pool,f.owner,true,c=>readStudioConversation(c,f.owner,s))).latestRequestId).toBe(legacy);
 expect((await f.c.query('SELECT request_snapshot FROM local_identity.script_format_requests WHERE id=$1',[legacy])).rows[0].request_snapshot.data).not.toHaveProperty('conversationId');
});
it.skipIf(!contextPath)('blocks another empty or pre-existing conversation from bypassing an uncertain request',async()=>{
 const s=scope('未知结果。'),id=randomUUID();await ownerTransaction(f.pool,f.owner,false,c=>createStudioConversation(c,f.owner,s,id));await receipt(s.text,'unknown');
 await expect(ownerTransaction(f.pool,f.owner,false,c=>createStudioConversation(c,f.owner,s,randomUUID()))).rejects.toThrow(/核对/);
 await expect(ownerTransaction(f.pool,f.owner,false,c=>assertNoUnresolvedStudioRequest(c,f.owner,{...s,conversationId:id}))).rejects.toThrow(/核对/);
 expect((await ownerTransaction(f.pool,f.owner,true,c=>listStudioConversations(c,f.owner,s))).some(value=>value.id===id)).toBe(true);
});
