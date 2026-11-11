import {useState} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceCaptionsPanel} from './WorkspaceCaptionsPanel';
import {EmbeddedStudioHost} from './EmbeddedStudioHost';
import {defaultShotCaptionContract} from '../shotCaptions';
import {applyWorkspaceCaptionEdit,readWorkspaceCaption} from '../workspaceCaptions';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import type {ProductionWorkspace} from '../productionWorkspace';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(){
 const contract=defaultShotCaptionContract('原字幕','independent');contract.cues=[{id:'cue',text:'原字幕',startMs:0,endMs:800}];
 let document:OpenChatCutProject=applyWorkspaceCaptionEdit({version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[{id:'item',kind:'image',track:'V1',startFrame:0,durationInFrames:90}],trackOrder:['V1'],tracks:{V1:{kind:'video',name:'video'}},transitions:[],selectedId:null,captionsHidden:false}]},'item',contract);
 const file={relativePath:'work/project.json',sha256:'a'.repeat(64),fileSize:42,projectId:'loop-control-e'};
 let workspace={id:'w',episodeId:'e',scriptRevisionId:'s',revision:2,stale:false,project:file,clips:[{id:'clip',itemId:'item',shotId:'S1',text:'镜头'}],captions:[{clipId:'clip',itemId:'item',shotId:'S1',contract:readWorkspaceCaption(document,'item')!.contract,inputFingerprint:'input',timing:'current',textConfirmed:false,durationMs:3000,audioTrackId:'voice',taskId:'alignment-task'}]} as unknown as ProductionWorkspace;
 let failRegistration=true,failSave=false,saveCalls=0;
 const command=vi.fn(async(name:string,_data:unknown)=>{if(name==='prepareWorkspaceCaptionAlignment')return {captionContract:readWorkspaceCaption(document,'item')!.contract};if(failRegistration)throw Error('登记连接中断');return workspace;});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 function View(){const [current,setCurrent]=useState(workspace);return <EmbeddedStudioHost episodeId="e" title="字幕恢复" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace:file,sourcePath:'project.json'}} shots={[]} onSave={async()=>{saveCalls++;if(failSave)throw Error('工程保存未确认');workspace={...workspace,revision:workspace.revision+1,project:{...file,sha256:String(workspace.revision+1).repeat(64)},captions:[{...workspace.captions![0],contract:readWorkspaceCaption(document,'item')!.contract}]};setCurrent(workspace);return workspace.project;}} onClose={()=>{}} captionEditor={bridge=><WorkspaceCaptionsPanel workspace={current} command={command} onChange={setCurrent} bridge={bridge}/>}/>;}
 render(<View/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,url=new URL(frame.src),channel=url.searchParams.get('lcChannel');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:url.origin,source:frame.contentWindow!,data:{channel,projectId:file.projectId,...data}}));
 const actions:string[]=[];let fingerprint='original';
 vi.spyOn(frame.contentWindow!,'postMessage').mockImplementation((message:unknown)=>{
  const request=message as Record<string,unknown>;actions.push(String(request.action));
  queueMicrotask(()=>{
   let result:unknown;
   if(request.action==='inspect')result={revision:workspace.revision,documentFingerprint:fingerprint,document};
   if(request.action==='apply-captions'){document=applyWorkspaceCaptionEdit(document,'item',request.contract as typeof contract,{timingOnly:request.timingOnly===true});fingerprint='applied';result={revision:workspace.revision,documentFingerprint:fingerprint,document};}
   deliver({type:'loop-control:result',requestId:request.requestId,ok:true,result});
  });
 });
 deliver({type:'loop-control:state',writable:true,revision:2,items:[],selectedIds:[]});deliver({type:'loop-control:caption-alignment-requested'});
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
 const fixture=setup();fireEvent.click(screen.getByRole('button',{name:'采用对齐'}));await screen.findByText('登记连接中断');
 fixture.failRegistration=false;fireEvent.click(screen.getByRole('button',{name:'继续保存字幕'}));
 await waitFor(()=>expect(fixture.command).toHaveBeenCalledTimes(3));
 expect(fixture.command.mock.calls.map(([name])=>name)).toEqual(['prepareWorkspaceCaptionAlignment','applyWorkspaceCaptionAlignment','applyWorkspaceCaptionAlignment']);
 expect(fixture.command.mock.calls[2]).toEqual(fixture.command.mock.calls[1]);
 expect(fixture.actions.filter(action=>action==='apply-captions')).toHaveLength(1);expect(fixture.saves).toBe(2);
});
