import {renderHook,waitFor,act,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
const {request,command}=vi.hoisted(()=>({request:vi.fn(),command:vi.fn()}));
vi.mock('./client',()=>({localRequest:request,localCommand:command}));
import {WorkspaceDraftOwner} from './WorkspaceDraft';
import {useScriptStudioAssistant} from './useScriptStudioAssistant';
import {localScriptStudioPlan} from '../scriptStudio';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const props={episodeId:'episode',scriptRevisionId:null,source:'雪山晨光。',targetDuration:15,disabled:false,conversationId:first};
const empty={turns:[],result:null,mode:'optimize'},plan=localScriptStudioPlan(props.source,15);
const saved={turns:[{requestId:'old',mode:'optimize',instruction:'旧要求',answer:'旧摘要',status:'completed'}],result:{requestId:'old',status:'completed',plan},latestRequestId:'old',mode:'optimize'};
const catalog={serviceCatalog:{groups:[{capability:'language_model',services:[{id:'model',provider:'openai',adapter:'openai_responses',models:['gpt-5.6-luna'],connectionVersionId:'connection',executable:true}]}]}};
function wrapper({children}:{children:ReactNode}){return <WorkspaceDraftOwner ownerId="owner">{children}</WorkspaceDraftOwner>;}
afterEach(()=>{cleanup();localStorage.clear();vi.resetAllMocks();});
it('binds restore and a fresh request to the selected empty conversation without a prior plan',async()=>{
 request.mockImplementation(async(path:string)=>path==='connections'?catalog:empty);command.mockResolvedValue({requestId:'new',status:'completed',message:'新讨论'});
 const {result}=renderHook(()=>useScriptStudioAssistant(props),{wrapper});await waitFor(()=>expect(result.current.conversationLoading).toBe(false));
 await act(async()=>{await result.current.send('discuss','重新构思');});
 const restored=request.mock.calls.find(([path])=>path==='script-studio');expect(JSON.parse(restored![1].body).data.conversationId).toBe(first);
 expect(command).toHaveBeenCalledWith('optimize',expect.objectContaining({conversationId:first,mode:'discuss',instruction:'重新构思'}),undefined,'script-studio');
 expect(command.mock.calls[0][1]).not.toHaveProperty('previousRequestId');
});
it('clears the previous candidate when switching conversation under the same source and duration',async()=>{
 request.mockImplementation(async(path:string,init?:RequestInit)=>path==='connections'?catalog:JSON.parse(String(init?.body)).data.conversationId===first?saved:empty);
 const {result,rerender}=renderHook(p=>useScriptStudioAssistant(p),{initialProps:props,wrapper});await waitFor(()=>expect(result.current.result?.requestId).toBe('old'));
 rerender({...props,conversationId:second});await waitFor(()=>expect(result.current.conversationLoading).toBe(false));
 expect(result.current.result).toBeNull();expect(result.current.turns).toEqual([]);expect(result.current.latestRequestId).toBeUndefined();expect(command).not.toHaveBeenCalled();
});
it('includes the active conversation in immutable manual operations',async()=>{
 request.mockImplementation(async(path:string)=>path==='connections'?catalog:saved);command.mockResolvedValue({requestId:'edited',status:'completed',plan});
 const {result}=renderHook(()=>useScriptStudioAssistant(props),{wrapper});await waitFor(()=>expect(result.current.result?.requestId).toBe('old'));
 await act(async()=>{await result.current.saveShot(0,{camera:'固定机位'});});
 expect(command).toHaveBeenCalledWith('editShot',expect.objectContaining({conversationId:first,previousRequestId:'old',fields:{camera:'固定机位'}}),undefined,'script-studio');
});
it('restores image context and binds newly selected images to their own turn',async()=>{
 const image={materialRevisionId:first,sha256:'a'.repeat(64),mimeType:'image/png' as const,fileSize:100,name:'reference.png'};
 request.mockImplementation(async(path:string)=>path==='connections'?catalog:{...empty,attachments:[]});
 command.mockResolvedValue({requestId:'image-turn',status:'completed',message:'已参考图片',attachments:[image]});
 const {result}=renderHook(()=>useScriptStudioAssistant(props),{wrapper});await waitFor(()=>expect(result.current.conversationLoading).toBe(false));
 await act(async()=>{await result.current.send('discuss','这张图片',undefined,[image]);});
 expect(command).toHaveBeenCalledWith('optimize',expect.objectContaining({attachments:[image],conversationId:first}),undefined,'script-studio');
 expect(result.current.attachments).toEqual([image]);expect(result.current.turns[0].attachments).toEqual([image]);
});

it('returns only a matching newly completed receipt when recovering a lost response',async()=>{
 const image={materialRevisionId:first,sha256:'a'.repeat(64),mimeType:'image/png' as const,fileSize:100,name:'reference.png'};
 let restored:unknown=empty;
 request.mockImplementation(async(path:string)=>path==='connections'?catalog:restored);
 command.mockRejectedValue(Object.assign(Error('response lost'),{status:503}));
 const {result}=renderHook(()=>useScriptStudioAssistant(props),{wrapper});await waitFor(()=>expect(result.current.conversationLoading).toBe(false));
 await act(async()=>{await result.current.send('discuss','解释图片',undefined,[image]);});
 expect(result.current.unresolved).toBe(true);
 const completed={requestId:'recovered',status:'completed',message:'理解完成',attachments:[image]};
 restored={...empty,latest:completed,latestRequestId:'recovered',attachments:[image],turns:[{requestId:'recovered',mode:'discuss',instruction:'解释图片',answer:'理解完成',status:'completed',attachments:[image]}]};
 let value:unknown;await act(async()=>{value=await result.current.send();});
 expect(value).toEqual(completed);expect(command).toHaveBeenCalledOnce();expect(result.current.unresolved).toBe(false);
});

it('blocks dispatch in the first enabled render before the restore effect runs',async()=>{
 request.mockImplementation(async(path:string)=>path==='connections'?catalog:empty);
 const seen:boolean[]=[];
 const {result}=renderHook(()=>{const state=useScriptStudioAssistant(props);seen.push(state.conversationLoading);return state;},{wrapper});
 expect(seen[0]).toBe(true);
 await waitFor(()=>expect(result.current.conversationLoading).toBe(false));
});
