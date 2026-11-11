import {webcrypto} from 'node:crypto';
import {localCommand,localRequest} from './client';
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceDraftOwner} from './WorkspaceDraft';
import {WorkspaceNarrationPanel} from './WorkspaceNarrationPanel';
import {WorkspaceMaterialSelectionProvider,workspaceMaterialDragType} from './WorkspaceMaterialDrop';
import type {ProductionWorkspace} from '../productionWorkspace';

afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
const materials=['first','second'].map(id=>({id,source_path:id+'.mp3',storage_path:'voice/'+id+'.mp3',material_type:'audio',material_purpose:'general_reference'}));
function setup(){
 let stored={id:'w',episodeId:'e',revision:1,stale:false,project:{sha256:'saved-sha'},clips:[{id:'clip',shotId:'S01',itemId:'item'}],candidates:[],narration:[{clipId:'clip',shotId:'S01',mode:'manual',enabled:true,text:'镜头正文',status:'pending',inputFingerprint:'initial'}]} as unknown as ProductionWorkspace;
 let failConfirm=false;
 const calls:Array<{name:string;data:Record<string,unknown>}>=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>Response.json(String(input).endsWith('/workspace')?{workspace:stored}:{serviceCatalog:{version:1,groups:[]}})));
 const command=vi.fn(async(name:string,input:unknown)=>{
  const data=input as Record<string,unknown>;calls.push({name,data});
  if(name==='prepareWorkspaceCandidate')return {adoptionId:'adoption',candidateId:data.candidateId,projectSha256:'saved-sha',edit:{source:{kind:'audio'}},impact:{currentSeconds:2,sourceSeconds:2,appliedSeconds:2,deltaSeconds:0,affectedFragments:[]}};
  expect(data.expectedRevision).toBe(stored.revision);
  if(name==='saveWorkspaceNarration'){
   const id=String(data.materialRevisionId),track='track-'+id;
   stored={...stored,revision:stored.revision+1,narration:[{...stored.narration![0],mode:'manual',audioTrackId:track,inputFingerprint:track}],candidates:[...stored.candidates??[],{id:track,audioTrackId:track,kind:'audio',shotId:'S01',relativePath:'voice/'+id+'.mp3',text:'镜头正文',durationSeconds:2,status:'available'}]} as unknown as ProductionWorkspace;
  }else if(name==='confirmWorkspaceNarration'){
   if(failConfirm){failConfirm=false;throw Error('确认读取中断');}
   stored={...stored,revision:stored.revision+1};
  }else if(name==='adoptWorkspaceCandidate')stored={...stored,revision:stored.revision+1,project:{...stored.project,sha256:'adopted-sha'},narration:[{...stored.narration![0],adoptedAudioTrackId:String(data.candidateId)}]};
  return stored;
 });
 function View({onImportAudio,knownMaterials=true,selectedShotId='S01',ownerId=''}:{onImportAudio?:(files:File[])=>Promise<unknown>;knownMaterials?:boolean;selectedShotId?:string;ownerId?:string}){const [w,setW]=useState(stored);return <WorkspaceDraftOwner ownerId={ownerId}><WorkspaceMaterialSelectionProvider materials={materials}><WorkspaceNarrationPanel episodeId="e" workspace={w} selectedShotId={selectedShotId} pending={false} command={command} onChanged={setW} materials={knownMaterials?materials:[]} onImportAudio={onImportAudio}/></WorkspaceMaterialSelectionProvider></WorkspaceDraftOwner>;}
 return {View,command,calls,get stored(){return stored;},set failConfirm(value:boolean){failConfirm=value;}};
}
function drop(id:string){fireEvent.drop(screen.getByRole('button',{name:'拖入口播文件'}),{dataTransfer:{types:[workspaceMaterialDragType],getData:(type:string)=>type===workspaceMaterialDragType?id:'',files:[]}});}

it('adds each dropped narration to the same audition and explicit adoption flow as TTS',async()=>{
 const f=setup();render(<f.View/>);
 expect(screen.queryByRole('combobox',{name:'口播素材或上传音轨'})).toBeNull();expect(screen.queryByRole('button',{name:'加入候选'})).toBeNull();
 drop('first');await screen.findByRole('button',{name:'试听 first.mp3'});
 drop('second');await waitFor(()=>expect(screen.getAllByRole('button',{name:'采用'})).toHaveLength(2));
 expect(f.calls.filter(c=>c.name==='saveWorkspaceNarration').map(c=>c.data.materialRevisionId)).toEqual(['first','second']);
 expect(f.calls.some(c=>c.name.startsWith('adopt'))).toBe(false);
 fireEvent.click(screen.getAllByRole('button',{name:'采用'})[1]);
 const review=await screen.findByRole('group',{name:'采用前核对'});expect(review).toBeTruthy();
 expect(f.calls.some(c=>c.name==='adoptWorkspaceCandidate')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'确认采用'}));
 await waitFor(()=>expect(f.command).toHaveBeenCalledWith('adoptWorkspaceCandidate',expect.objectContaining({candidateId:'track-second',adoptionId:'adoption'})));
 expect(f.calls.some(c=>c.name==='generateWorkspaceNarration')).toBe(false);
});

it('registers every uploaded ID without waiting for parent material props',async()=>{
 const f=setup(),upload=vi.fn(async()=>['first','second']);render(<f.View onImportAudio={upload} knownMaterials={false}/>);
 const files=[new File(['one'],'first.mp3',{type:'audio/mpeg'}),new File(['two'],'second.mp3',{type:'audio/mpeg'})];
 fireEvent.change(screen.getByLabelText('导入人工口播'),{target:{files}});
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'采用'})).toHaveLength(2));
 expect(upload).toHaveBeenCalledWith(files);expect(f.calls.filter(c=>c.name==='saveWorkspaceNarration').map(c=>c.data.expectedRevision)).toEqual([1,3]);
});

it('retries confirmation without reimporting or repeating a confirmed save',async()=>{
 const f=setup();f.failConfirm=true;const upload=vi.fn(async()=>['first']);render(<f.View onImportAudio={upload} knownMaterials={false}/>);
 fireEvent.change(screen.getByLabelText('导入人工口播'),{target:{files:[new File(['one'],'first.mp3',{type:'audio/mpeg'})]}});
 await screen.findByText(/确认读取中断/);
 fireEvent.click(screen.getByRole('button',{name:'重试加入候选'}));
 await screen.findByRole('button',{name:'采用'});
 expect(upload).toHaveBeenCalledTimes(1);expect(f.calls.filter(c=>c.name==='saveWorkspaceNarration')).toHaveLength(1);expect(f.calls.filter(c=>c.name==='confirmWorkspaceNarration')).toHaveLength(2);
});

it('stops the old target after a late material registration receipt',async()=>{
 const f=setup();let finish!:()=>void;const wait=new Promise<void>(resolve=>{finish=resolve;});
 const execute=f.command.getMockImplementation()!;
 f.command.mockImplementation(async(name,input)=>{const value=await execute(name,input);if(name==='saveWorkspaceNarration')await wait;return value;});
 const view=render(<f.View/>);drop('first');await waitFor(()=>expect(f.calls.some(c=>c.name==='saveWorkspaceNarration')).toBe(true));
 view.rerender(<f.View selectedShotId="S02"/>);
 await act(async()=>{finish();});
 expect(f.calls.some(c=>c.name==='confirmWorkspaceNarration')).toBe(false);
});
it('retries registration from its imported material ID after an HTTP command failure',async()=>{
 const f=setup(),execute=f.command.getMockImplementation()!;let failed=false;
 f.command.mockImplementation(async(name,input)=>{if(name==='saveWorkspaceNarration'&&!failed){failed=true;throw Error('候选登记中断');}return execute(name,input);});
 const upload=vi.fn(async()=>['first']);render(<f.View onImportAudio={upload} knownMaterials={false}/>);
 fireEvent.change(screen.getByLabelText('导入人工口播'),{target:{files:[new File(['one'],'first.mp3',{type:'audio/mpeg'})]}});
 await screen.findByText('候选登记中断');fireEvent.click(screen.getByRole('button',{name:'重试加入候选'}));
 await screen.findByRole('button',{name:'采用'});expect(upload).toHaveBeenCalledTimes(1);
 expect(f.command.mock.calls.filter(([name])=>name==='saveWorkspaceNarration')).toHaveLength(2);
 expect(f.command.mock.calls.filter(([name])=>name==='generateWorkspaceNarration'||name.startsWith('adopt'))).toHaveLength(0);
});
it('does not register imported files after the narration visit unmounts',async()=>{
 const f=setup();let finish!:(value:string[])=>void;const upload=vi.fn(()=>new Promise<string[]>(resolve=>{finish=resolve;}));
 const view=render(<f.View onImportAudio={upload}/>);
 fireEvent.change(screen.getByLabelText('导入人工口播'),{target:{files:[new File(['one'],'first.mp3',{type:'audio/mpeg'})]}});
 await waitFor(()=>expect(upload).toHaveBeenCalledTimes(1));view.unmount();await act(async()=>{finish(['first']);});
 expect(f.command).not.toHaveBeenCalled();
});

it('accepts a new batch upload after adopting an earlier manual candidate',async()=>{
 const f=setup(),upload=vi.fn(async()=>['third','fourth']);render(<f.View onImportAudio={upload}/>);
 drop('first');fireEvent.click(await screen.findByRole('button',{name:'采用'}));await screen.findByRole('group',{name:'采用前核对'});fireEvent.click(screen.getByRole('button',{name:'确认采用'}));
 await waitFor(()=>expect(f.calls.some(c=>c.name==='adoptWorkspaceCandidate')).toBe(true));
 const input=screen.getByLabelText('导入人工口播');await waitFor(()=>expect(input).not.toHaveProperty('disabled',true));
 fireEvent.change(input,{target:{files:[new File(['three'],'third.mp3',{type:'audio/mpeg'}),new File(['four'],'fourth.mp3',{type:'audio/mpeg'})]}});
 await waitFor(()=>expect(f.calls.filter(c=>c.name==='saveWorkspaceNarration')).toHaveLength(3));expect(upload).toHaveBeenCalledTimes(1);
});
it('retains a failed confirmation across shot switching and panel reopening without repeating import or save',async()=>{
 const f=setup();f.failConfirm=true;const ownerId='reopen-manual-owner',upload=vi.fn(async()=>['first']);
 const view=render(<f.View ownerId={ownerId} onImportAudio={upload}/>);
 fireEvent.change(screen.getByLabelText('导入人工口播'),{target:{files:[new File(['one'],'first.mp3',{type:'audio/mpeg'})]}});await screen.findByText('确认读取中断');
 view.rerender(<f.View ownerId={ownerId} selectedShotId="S02" onImportAudio={upload}/>);view.rerender(<f.View ownerId={ownerId} onImportAudio={upload}/>);expect(screen.getByRole('button',{name:'重试加入候选'})).toBeTruthy();
 view.unmount();const other=render(<f.View ownerId="different-manual-owner" onImportAudio={upload}/>);expect(screen.queryByRole('button',{name:'重试加入候选'})).toBeNull();other.unmount();
 render(<f.View ownerId={ownerId} onImportAudio={upload}/>);fireEvent.click(screen.getByRole('button',{name:'重试加入候选'}));await screen.findByRole('button',{name:'采用'});
 expect(upload).toHaveBeenCalledTimes(1);expect(f.calls.filter(c=>c.name==='saveWorkspaceNarration')).toHaveLength(1);expect(f.calls.filter(c=>c.name==='confirmWorkspaceNarration')).toHaveLength(2);
});
it('receives a late save in the original session and lets a reopened visit explicitly finish confirmation',async()=>{
 const f=setup(),execute=f.command.getMockImplementation()!;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 f.command.mockImplementation(async(name,data)=>{const value=await execute(name,data);if(name==='saveWorkspaceNarration')await gate;return value;});
 const first=render(<f.View ownerId="late-manual-owner"/>);drop('first');await waitFor(()=>expect(f.calls.some(c=>c.name==='saveWorkspaceNarration')).toBe(true));first.unmount();
 render(<f.View ownerId="late-manual-owner"/>);expect(screen.getByRole('button',{name:'拖入口播文件'})).toHaveProperty('disabled',true);
 await act(async()=>release());await screen.findByRole('button',{name:'重试加入候选'});expect(f.calls.some(c=>c.name==='confirmWorkspaceNarration')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'重试加入候选'}));await screen.findByRole('button',{name:'采用'});expect(f.calls.filter(c=>c.name==='saveWorkspaceNarration')).toHaveLength(1);expect(f.calls.filter(c=>c.name==='confirmWorkspaceNarration')).toHaveLength(1);
});
it('reopens after an unknown HTTP confirmation and reads its frozen receipt without confirming twice',async()=>{
 const f=setup(),execute=f.command.getMockImplementation()!,receipts=new Map<string,unknown>(),confirmKeys:string[]=[],readbackKeys:string[]=[];let lost=false;
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'manual-http-fixture'});
  if(init?.method==='POST'){
   if(path.endsWith('/command-receipt')){const query=JSON.parse(String(init.body));readbackKeys.push(query.operation.idempotencyKey);return Response.json(readbackKeys.length===1?{status:'unknown'}:{status:'committed',result:receipts.get(query.operation.idempotencyKey)});}
   const body=JSON.parse(String(init.body));if(body.command==='confirmWorkspaceNarration')confirmKeys.push(body.idempotencyKey);
   if(receipts.has(body.idempotencyKey))return Response.json(receipts.get(body.idempotencyKey));
   const value=await execute(body.command,body.data);receipts.set(body.idempotencyKey,value);
   if(body.command==='confirmWorkspaceNarration'&&!lost){lost=true;return Response.json({error:'确认回包中断'},{status:503});}return Response.json(value);
  }
  return Response.json(path.endsWith('/workspace')?{workspace:f.stored}:{serviceCatalog:{version:1,groups:[]}});
 }));await localRequest('session');f.command.mockImplementation((name,data)=>localCommand(name,data,undefined,'episode-commands'));
 const first=render(<f.View ownerId="http-manual-owner"/>);drop('first');await screen.findByText(/本次操作结果暂未确认/);first.unmount();
 render(<f.View ownerId="http-manual-owner"/>);fireEvent.click(screen.getByRole('button',{name:'重试加入候选'}));await screen.findByRole('button',{name:'采用'});
 expect(confirmKeys).toHaveLength(1);expect(readbackKeys).toEqual([confirmKeys[0],confirmKeys[0]]);expect(f.calls.filter(c=>c.name==='saveWorkspaceNarration')).toHaveLength(1);expect(f.calls.filter(c=>c.name==='confirmWorkspaceNarration')).toHaveLength(1);expect(f.stored.revision).toBe(3);
});
it('does not publish a late initial read after the manual narration visit switches shots',async()=>{
 const f=setup(),changed=vi.fn();let finish!:(r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/workspace')?new Promise<Response>(resolve=>{finish=resolve;}):Response.json({serviceCatalog:{version:1,groups:[]}})));
 const viewFor=(shot:string)=><WorkspaceDraftOwner ownerId="manual-read-owner"><WorkspaceMaterialSelectionProvider materials={materials}><WorkspaceNarrationPanel episodeId="e" workspace={f.stored} selectedShotId={shot} pending={false} command={f.command} onChanged={changed} materials={materials}/></WorkspaceMaterialSelectionProvider></WorkspaceDraftOwner>;
 const view=render(viewFor('S01'));drop('first');await waitFor(()=>expect(finish).toBeTypeOf('function'));view.rerender(viewFor('S02'));
 await act(async()=>finish(Response.json({workspace:{...f.stored,revision:2}})));expect(changed).not.toHaveBeenCalled();expect(f.command).not.toHaveBeenCalled();
});
