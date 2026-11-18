// @vitest-environment node
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {listStudioConversations,assertStudioConversation,assertNoUnresolvedStudioRequest} from './scriptStudioSessions';
const scope={episodeId:'episode',expectedScriptRevisionId:null,text:'原文。',targetDuration:15};
const client=(fn:(sql:string,params?:unknown[])=>unknown[])=>({query:vi.fn(async(sql:string,params?:unknown[])=>({rows:fn(sql,params)}))}) as unknown as PoolClient;
it('numbers legacy and explicit conversations once in chronological order without rewriting old receipts',async()=>{
 const c=client(sql=>sql.includes('script_studio_conversations')?[{id:'new',created_at:'2026-11-18T10:01:00.000Z'}]:[{created_at:'2026-11-18T10:00:00.000Z'}]);
 expect(await listStudioConversations(c,'owner',scope)).toEqual([{id:null,number:1,createdAt:'2026-11-18T10:00:00.000Z'},{id:'new',number:2,createdAt:'2026-11-18T10:01:00.000Z'}]);
});
it('starts the first explicit conversation at one and does not duplicate numbers if an old client later writes an implicit chain',async()=>{
 let legacy=false;const c=client(sql=>sql.includes('script_studio_conversations')?[{id:'first',created_at:'2026-11-18T10:00:00.000Z'}]:legacy?[{created_at:'2026-11-18T10:01:00.000Z'}]:[]);
 expect((await listStudioConversations(c,'owner',scope)).map(x=>x.number)).toEqual([1]);legacy=true;
 expect(await listStudioConversations(c,'owner',scope)).toEqual([{id:'first',number:1,createdAt:'2026-11-18T10:00:00.000Z'},{id:null,number:2,createdAt:'2026-11-18T10:01:00.000Z'}]);
});
it('rejects a conversation from a different owner, source or duration',async()=>{
 await expect(assertStudioConversation(client(()=>[]),'owner',{...scope,conversationId:'11111111-1111-4111-8111-111111111111'})).rejects.toThrow(/对话/);
});
it('blocks fresh dispatch or new conversations while any request in the scope is uncertain',async()=>{
 const c=client(()=>[{id:'uncertain'}]);await expect(assertNoUnresolvedStudioRequest(c,'owner',scope)).rejects.toThrow(/核对/);
});
