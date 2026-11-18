import {renderHook,waitFor,act,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
const {request,command}=vi.hoisted(()=>({request:vi.fn(),command:vi.fn()}));
vi.mock('./client',()=>({localRequest:request,localCommand:command}));
import {WorkspaceDraftOwner} from './WorkspaceDraft';
import {useScriptStudioAssistant} from './useScriptStudioAssistant';
import {localScriptStudioPlan} from '../scriptStudio';
const source='雪山晨光。',plan=localScriptStudioPlan(source,15),receipt={requestId:'plan',status:'completed' as const,plan};
const catalog={serviceCatalog:{groups:[{capability:'language_model',services:[{id:'model',provider:'openai',adapter:'openai_responses',models:['gpt-5.6-luna'],connectionVersionId:'connection',executable:true}]}]}};
const saved={result:receipt,latest:{requestId:'talk',status:'completed',message:'已记下。'},latestRequestId:'talk',mode:'optimize',turns:[{requestId:'talk',mode:'discuss',instruction:'不要人物。',answer:'已记下。',status:'completed'}]};
const props={episodeId:'episode',scriptRevisionId:null,source,targetDuration:15,disabled:false};
function wrapper({children}:{children:ReactNode}){return <WorkspaceDraftOwner ownerId="owner">{children}</WorkspaceDraftOwner>;}
function mocks(value:unknown=saved){request.mockImplementation(async(path:string)=>path==='connections'?catalog:value);}
afterEach(()=>{cleanup();localStorage.clear();vi.resetAllMocks();});
it('restores the conversation and adoptable receipt without dispatching a model',async()=>{
 mocks();const {result}=renderHook(()=>useScriptStudioAssistant(props),{wrapper});await waitFor(()=>expect(result.current.result?.requestId).toBe('plan'));
 expect(result.current.turns[0].instruction).toBe('不要人物。');expect(result.current.latestRequestId).toBe('talk');expect(command).not.toHaveBeenCalled();
});
it('keeps the current plan while discussing and chains the next generation through the discussion',async()=>{
 mocks();command.mockResolvedValueOnce({requestId:'talk2',status:'completed',message:'可以更舒缓。'}).mockResolvedValueOnce({...receipt,requestId:'new-plan'});
 const {result}=renderHook(()=>useScriptStudioAssistant(props),{wrapper});await waitFor(()=>expect(result.current.result?.requestId).toBe('plan'));
 await act(async()=>{await result.current.send('discuss','再慢一点',result.current.latestRequestId);});
 expect(result.current.result?.requestId).toBe('plan');expect(result.current.turns).toHaveLength(2);
 await act(async()=>{await result.current.send('optimize','按这个调整',result.current.latestRequestId);});
 expect(command).toHaveBeenLastCalledWith('optimize',expect.objectContaining({mode:'optimize',instruction:'按这个调整',previousRequestId:'talk2'}),undefined,'script-studio');expect(result.current.result?.requestId).toBe('new-plan');
});
it('ignores a restored conversation received after switching source or Owner scope',async()=>{
 let resolve!:(value:unknown)=>void;request.mockImplementation((path:string)=>path==='connections'?Promise.resolve(catalog):new Promise(r=>{resolve=r;}));
 const {result,rerender}=renderHook(p=>useScriptStudioAssistant(p),{initialProps:props,wrapper});await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 rerender({...props,source:'另一份脚本'});await act(async()=>resolve(saved));expect(result.current.result).toBeNull();expect(result.current.turns).toEqual([]);expect(command).not.toHaveBeenCalled();
});
it('recovers an unknown request after refresh without starting another model request',async()=>{
 const unknown={requestId:'unknown',status:'unknown',message:'结果未知。'};mocks({...saved,latest:unknown,latestRequestId:'unknown'});
 const {result}=renderHook(()=>useScriptStudioAssistant(props),{wrapper});await waitFor(()=>expect(result.current.unresolved).toBe(true));
 await act(async()=>{await result.current.send();});expect(command).not.toHaveBeenCalled();expect(result.current.unresolved).toBe(true);
});
