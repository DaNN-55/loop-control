import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {localScriptStudioPlan,type ScriptStudioConversation} from '../scriptStudio';
import type {ScriptStudioAttachmentRef} from '../scriptStudioAttachments';
const {request,command}=vi.hoisted(()=>({request:vi.fn(),command:vi.fn()}));
vi.mock('./client',()=>({localRequest:request,localCommand:command}));
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
import {WorkspaceDraftProvider} from './WorkspaceDraft';

afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();vi.resetAllMocks();});

it('acknowledges a completed lost-response turn after remount without keeping sent attachments or erasing a later draft',async()=>{
 const owner='recovery-owner',episodeId='recovery-episode',source='雪山晨光。',instruction='参考图片保持缓慢推进。';
 const image:ScriptStudioAttachmentRef={materialRevisionId:'11111111-1111-4111-8111-111111111111',sha256:'a'.repeat(64),mimeType:'image/png',fileSize:100,name:'reference.png'};
 const materials=[{id:image.materialRevisionId,storage_path:'materials/reference.png',source_path:image.name,material_type:'image',mime_type:image.mimeType,file_size:image.fileSize,sha256:image.sha256}];
 const scope=JSON.stringify([owner,episodeId,null,source,null,null]);
 // This immutable reference represents an already uploaded, selected business material.
 localStorage.setItem('loop-control.script-studio-attachments.v1:'+JSON.stringify([owner,scope]),JSON.stringify([image]));
 let conversation:ScriptStudioConversation={turns:[],result:null,mode:'optimize'};
 request.mockImplementation(async(path:string,init?:RequestInit)=>{
  if(path==='connections')return{serviceCatalog:{groups:[{capability:'language_model',services:[{id:'model',provider:'openai',adapter:'openai_responses',models:['gpt-5.6-luna'],connectionVersionId:'connection',executable:true}]}]}};
  if(path==='script-studio')return JSON.parse(String(init?.body)).command==='conversations'?{conversations:conversation.latest?[{id:null,number:1,createdAt:'2026-11-18T00:00:00.000Z'}]:[]}:conversation;
  throw Error('Unexpected local read: '+path);
 });
 command.mockImplementation(async(name:string,data:{instruction:string;mode:'optimize';attachments:ScriptStudioAttachmentRef[]})=>{
  expect(name).toBe('optimize');
  const plan=localScriptStudioPlan(source,15),latest={requestId:'completed-despite-lost-response',status:'completed' as const,plan,attachments:[image]};
  conversation={turns:[{requestId:latest.requestId,mode:data.mode,instruction:data.instruction,answer:plan.summary,status:'completed',attachments:data.attachments.map(ref=>Object.fromEntries(Object.entries(ref).sort(([a],[b])=>a.localeCompare(b))) as unknown as ScriptStudioAttachmentRef)}],result:latest,latest,latestRequestId:latest.requestId,attachments:[image],mode:'optimize'};
  throw Object.assign(Error('HTTP response lost after server committed'),{status:503});
 });
 const element=<WorkspaceDraftProvider ownerId={owner}><WorkspaceScriptPanel episodeId={episodeId} scriptRevisionId={null} script={source} stage="waiting_input" readOnly={false} pending={false} materials={materials} command={vi.fn()} onConfirmed={vi.fn()}/></WorkspaceDraftProvider>;
 let view=render(element);
 await waitFor(()=>expect(request.mock.calls.some(([path,init])=>path==='script-studio'&&JSON.parse(init.body).command==='conversation')).toBe(true));
 const input=screen.getByRole('textbox',{name:'修改要求'});await waitFor(()=>expect(input).toHaveProperty('disabled',false));
 expect(screen.getByRole('button',{name:'移除附件 reference.png'})).toBeTruthy();
 fireEvent.change(input,{target:{value:instruction}});fireEvent.submit(screen.getByRole('form',{name:'拍法对话'}));
 await screen.findByRole('button',{name:'核对本次请求'});expect(command).toHaveBeenCalledExactlyOnceWith('optimize',expect.objectContaining({instruction,attachments:[image]}),undefined,'script-studio');
 view.unmount();view=render(element);
 await screen.findByRole('button',{name:'采用并继续'});const restored=screen.getByRole('textbox',{name:'修改要求'});
 await waitFor(()=>expect(restored).toHaveProperty('disabled',false));
 await waitFor(()=>expect(restored).toHaveProperty('value',''));
 expect(within(screen.getByRole('form',{name:'拍法对话'})).queryByRole('button',{name:'移除附件 reference.png'})).toBeNull();
 expect(within(screen.getByRole('list',{name:'拍法对话记录'})).getByRole('img',{name:'reference.png'})).toBeTruthy();
 fireEvent.change(restored,{target:{value:'这是恢复以后新写、还没有发送的要求'}});
 view.unmount();render(element);
 await screen.findByRole('button',{name:'采用并继续'});const newer=screen.getByRole('textbox',{name:'修改要求'});
 await waitFor(()=>expect(newer).toHaveProperty('disabled',false));
 expect(newer).toHaveProperty('value','这是恢复以后新写、还没有发送的要求');
 expect(within(screen.getByRole('form',{name:'拍法对话'})).queryByRole('button',{name:'移除附件 reference.png'})).toBeNull();
 expect(command).toHaveBeenCalledOnce();
});
