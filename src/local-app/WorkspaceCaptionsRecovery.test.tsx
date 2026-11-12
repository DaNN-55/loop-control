import {useState} from 'react';
import {webcrypto} from 'node:crypto';
import {localCommand} from './client';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceCaptionsPanel} from './WorkspaceCaptionsPanel';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import {defaultShotCaptionContract} from '../shotCaptions';
import {applyWorkspaceCaptionEdit,readWorkspaceCaption} from '../workspaceCaptions';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import type {ProductionWorkspace} from '../productionWorkspace';

afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
function setup(alignmentReady=false){
 const contract=defaultShotCaptionContract('原字幕','independent');contract.cues=[{id:'cue',text:'原字幕',startMs:0,endMs:800}];
 let document:OpenChatCutProject=applyWorkspaceCaptionEdit({version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[{id:'item',kind:'image',track:'V1',startFrame:0,durationInFrames:90}],trackOrder:['V1'],tracks:{V1:{kind:'video',name:'video'}},transitions:[],selectedId:null,captionsHidden:false}]},'item',contract);
 const file={relativePath:'work/project.json',sha256:'a'.repeat(64),fileSize:42,projectId:'loop-control-e'};
 let workspace={id:'w',episodeId:'e',scriptRevisionId:'s',revision:2,stale:false,project:file,clips:[{id:'clip',itemId:'item',shotId:'S1',text:'镜头'}],captions:[{clipId:'clip',itemId:'item',shotId:'S1',contract:readWorkspaceCaption(document,'item')!.contract,inputFingerprint:'input',timing:alignmentReady?'waiting':'current',alignmentStatus:alignmentReady?'completed':undefined,textConfirmed:false,durationMs:3000,audioTrackId:'voice',taskId:'alignment-task'}]} as unknown as ProductionWorkspace;
 let failRegistration=true,failSave=false,saveCalls=0;
 const command=vi.fn(async(name:string,_data:unknown)=>{if(name==='prepareWorkspaceCaptionAlignment')return {captionContract:readWorkspaceCaption(document,'item')!.contract};if(failRegistration)throw Error('登记连接中断');return workspace;});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 // The compatibility bridge is supplied directly. The production host no longer
 // renders a subtitle side panel; the generic operation hook still supports a
 // caller that owns native persistence and idempotent post-apply save receipts.
 const actions:string[]=[];let fingerprint='original',receipt:{key:string;fingerprint:string}|null=null;
 let publish:((value:ProductionWorkspace)=>void)=()=>{};
 async function saveNative(){
  saveCalls++;if(failSave)throw Error('工程保存未确认');
  workspace={...workspace,revision:workspace.revision+1,project:{...file,sha256:String(workspace.revision+1).repeat(64)},captions:[{...workspace.captions![0],contract:readWorkspaceCaption(document,'item')!.contract}]};
  publish(workspace);
 }
 const bridge:EmbeddedStudioBridge={connected:true,
  async inspect(){actions.push('inspect');return {revision:workspace.revision,documentFingerprint:fingerprint,document:structuredClone(document)};},
  async save(){actions.push('flush');await saveNative();},
  async applyCaptions(itemId,next,timingOnly=false){
   const key=JSON.stringify({itemId,next,timingOnly});
   if(receipt?.key===key){if(receipt.fingerprint!==fingerprint)throw Error('工程已有新修改，请核对字幕后重新操作。');}
   else{actions.push('apply-captions');document=applyWorkspaceCaptionEdit(document,itemId,next,{timingOnly});fingerprint='applied';receipt={key,fingerprint};}
   await saveNative();receipt=null;return readWorkspaceCaption(document,itemId)!.contract;
  },
  async applyEdit(){throw Error('Caption recovery does not edit shot structure');},
  async applyNativeEdit(){throw Error('Caption recovery does not edit media');},
 };
 function View(){const [current,setCurrent]=useState(workspace);publish=setCurrent;return <WorkspaceCaptionsPanel workspace={current} command={command} onChange={setCurrent} bridge={bridge}/>;}
 render(<View/>);
 return {command,actions,editNative(){fingerprint='changed-by-user';},get saves(){return saveCalls;},get workspace(){return workspace;},get document(){return document;},set failRegistration(value:boolean){failRegistration=value;},set failSave(value:boolean){failSave=value;}};
}
it('continues caption registration after native saving succeeded without applying the edit again',async()=>{
 const fixture=setup();fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));
 await screen.findByText('登记连接中断');expect(fixture.saves).toBe(1);
 fixture.failRegistration=false;
 fireEvent.click(screen.getByRole('button',{name:'继续保存字幕'}));
 await waitFor(()=>expect(fixture.command).toHaveBeenCalledTimes(2));
 expect(fixture.actions.filter(action=>action==='apply-captions')).toHaveLength(1);
 expect(fixture.saves).toBe(1);
 expect(fixture.command.mock.calls[1]).toEqual(fixture.command.mock.calls[0]);
});
it('continues the saved native caption intent when Owner saving failed after the editor applied it',async()=>{
 const fixture=setup();fixture.failSave=true;
 fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));
 await screen.findAllByText('工程保存未确认');
 fixture.failSave=false;fixture.failRegistration=false;
 fireEvent.click(screen.getByRole('button',{name:'继续保存字幕'}));
 await waitFor(()=>expect(fixture.command).toHaveBeenCalledTimes(1));
 expect(fixture.actions.filter(action=>action==='apply-captions')).toHaveLength(1);
 expect(fixture.saves).toBe(2);
});

it('resumes a failed authoritative read after native saving without replaying the edit',async()=>{
 const fixture=setup();let reads=0;fixture.failRegistration=false;
 vi.stubGlobal('fetch',vi.fn(async()=>++reads===1?Response.json({error:'暂时无法读取'},{status:503}):Response.json({workspace:fixture.workspace})));
 fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));await screen.findByText('无法读取当前保存版本。');
 fireEvent.click(screen.getByRole('button',{name:'继续保存字幕'}));await waitFor(()=>expect(fixture.command).toHaveBeenCalledTimes(1));
 expect(fixture.actions.filter(action=>action==='apply-captions')).toHaveLength(1);expect(fixture.saves).toBe(1);
});
it('stops a pending registration continuation when the native document has changed',async()=>{
 const fixture=setup();fireEvent.click(screen.getByRole('button',{name:'保存字幕'}));await screen.findByText('登记连接中断');
 fixture.editNative();fixture.failRegistration=false;
 fireEvent.click(screen.getByRole('button',{name:'继续保存字幕'}));await screen.findByText('编辑器已有新修改，请核对后重新操作。');
 expect(fixture.command).toHaveBeenCalledTimes(1);expect(fixture.actions.filter(action=>action==='apply-captions')).toHaveLength(1);
});
it('continues alignment registration after the prepared timing was already saved in Studio',async()=>{
 const fixture=setup(true);fireEvent.click(screen.getByRole('button',{name:'采用对齐'}));await screen.findByText('登记连接中断');
 fixture.failRegistration=false;fireEvent.click(screen.getByRole('button',{name:'继续保存字幕'}));
 await waitFor(()=>expect(fixture.command).toHaveBeenCalledTimes(3));
 expect(fixture.command.mock.calls.map(([name])=>name)).toEqual(['prepareWorkspaceCaptionAlignment','applyWorkspaceCaptionAlignment','applyWorkspaceCaptionAlignment']);
 expect(fixture.command.mock.calls[2]).toEqual(fixture.command.mock.calls[1]);
 expect(fixture.actions.filter(action=>action==='apply-captions')).toHaveLength(1);expect(fixture.saves).toBe(2);
});

it.each([['声学对齐','requestWorkspaceCaptionAlignment'],['正文已核对','confirmWorkspaceCaptionText'],['保存字幕','saveWorkspaceCaptions']])('recovers a committed %s receipt through the real command client after a lost response',async(label,name)=>{
 const contract=defaultShotCaptionContract('待核对字幕','independent');contract.cues=[{id:'cue',text:contract.text,startMs:0,endMs:800}];
 let workspace={id:'receipt-w',episodeId:'receipt-e',scriptRevisionId:'script',revision:2,stale:false,project:{relativePath:'project.json',sha256:'stable-sha',fileSize:2,projectId:'project'},clips:[{id:'clip',itemId:'item',shotId:'S1',text:'镜头'}],captions:[{clipId:'clip',itemId:'item',shotId:'S1',contract,inputFingerprint:'original',timing:'current',textConfirmed:false,audioTrackId:'voice',taskId:null,durationMs:2000}]} as unknown as ProductionWorkspace;
 let writes=0;const receipts=new Map<string,ProductionWorkspace>(),keys:string[]=[],readbacks:string[]=[];
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'caption-receipt'});
  if(!init?.method)return Response.json({workspace});
  if(path.endsWith('/command-receipt')){const request=JSON.parse(String(init.body));readbacks.push(request.operation.idempotencyKey);return Response.json({status:'committed',result:receipts.get(request.operation.idempotencyKey)});}
  const request=JSON.parse(String(init.body));keys.push(request.idempotencyKey);
  if(receipts.has(request.idempotencyKey))return Response.json(receipts.get(request.idempotencyKey));
  writes++;workspace={...workspace,revision:3,project:{...workspace.project,sha256:name==='saveWorkspaceCaptions'?'changed-sha':'stable-sha'},captions:[{...workspace.captions![0],contract:request.data.captionContract??workspace.captions![0].contract,textConfirmed:name==='confirmWorkspaceCaptionText',timing:name==='requestWorkspaceCaptionAlignment'?'waiting':name==='saveWorkspaceCaptions'?'missing':'current'}]};receipts.set(request.idempotencyKey,workspace);
  return Response.json({error:'命令已提交但回执暂不可用'},{status:503});
 }));
 function View(){const [current,setCurrent]=useState(workspace);return <WorkspaceCaptionsPanel workspace={current} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onChange={setCurrent}/>;}
 render(<View/>);if(name==='saveWorkspaceCaptions')fireEvent.change(screen.getByRole('textbox',{name:'字幕正文'}),{target:{value:'保存的新字幕'}});fireEvent.click(screen.getByRole('button',{name:label}));await waitFor(()=>{expect(readbacks).toHaveLength(1);expect(screen.getAllByRole('status')).toHaveLength(1);});
 expect(writes).toBe(1);expect(keys).toHaveLength(1);expect(readbacks[0]).toBe(keys[0]);expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByRole('status').textContent).toContain(name==='confirmWorkspaceCaptionText'?'正文已核对':name==='saveWorkspaceCaptions'?'待校时':'对齐处理中');
});
