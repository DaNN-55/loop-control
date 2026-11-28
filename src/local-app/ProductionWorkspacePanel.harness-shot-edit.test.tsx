import {webcrypto} from 'node:crypto';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import type {ProductionWorkspace} from '../productionWorkspace';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import {localCommand} from './client';
import {attachNativeSurface} from './nativeSurface';
import {WorkspacePreparationSections} from './WorkspacePreparationSections';

const episodeId='11111111-1111-4111-8111-111111111111',workspaceId='22222222-2222-4222-8222-222222222222';
const projectSha='a'.repeat(64),sourceSha='b'.repeat(64),sourcePath=`episodes/${episodeId}/original.mp4`;
const first={id:'clip-1',itemId:'item-1',shotId:'shot-1',text:'第一镜',source:null},second={id:'clip-2',itemId:'item-2',shotId:'shot-2',text:'第二镜',source:null},third={id:'clip-3',itemId:'item-3',shotId:'shot-3',text:'新增测试镜头',source:null};
const currentVideo={...first,source:{kind:'video' as const,relativePath:sourcePath,sha256:sourceSha,fileSize:100,materialRevisionId:'material'}};
const saved=(clips:ProductionWorkspace['clips'],revision=1,sha256=projectSha):ProductionWorkspace=>({id:workspaceId,episodeId,workflowVersion:'four-step/v1',scriptRevisionId:'s',storyboardPackageId:null,revision,contentSha256:projectSha,clips,history:[],project:{relativePath:`episodes/${episodeId}/project.json`,sha256,fileSize:100,projectId:'p'},readiness:{deliverable:false,placeholders:[],missingSources:[]},stale:false});
const project={assets:[{id:'asset',durationInFrames:120,sourceContentHash:sourceSha}],timelines:[{id:'timeline',fps:30,width:1080,height:1920,tracks:{},items:[{id:first.itemId,kind:'video',src:sourcePath,sourceAssetId:'asset',startFrame:0,srcInFrame:0,durationInFrames:60}]}]};
const workRoute=`/api/local/episodes/${episodeId}/workspace`;
interface RequestData {command:string;idempotencyKey:string;data:{episodeId:string;workspaceId:string;expectedRevision:number;operation:Record<string,unknown>}}
let detach:(()=>void)|undefined;
afterEach(()=>{cleanup();detach?.();detach=undefined;vi.unstubAllGlobals();vi.restoreAllMocks();sessionStorage.clear();localStorage.clear();});
function setup(workspace:ProductionWorkspace,options:{video?:boolean;readOnly?:boolean;read?:()=>Promise<ProductionWorkspace>;post?:(body:RequestData)=>Promise<ProductionWorkspace>}={}){
 const calls:string[]=[],posts:RequestData[]=[];
 vi.stubGlobal('crypto',webcrypto);
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 detach=attachNativeSurface(document.body,'/api/team-loop-control/native');
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const url=new URL(input,'http://localhost'),path=url.searchParams.get('path');
  if(url.pathname!=='/api/team-loop-control/native'||!path)throw Error(`Not a native route: ${input}`);
  calls.push(path);
  if(path==='/api/local/session')return Response.json({owner:{id:'owner'}});
  if(path===workRoute)return Response.json({workspace:await (options.read?.()??workspace)});
  if(path.startsWith(workRoute+'/project?sha='))return Response.json({project:options.video?project:null});
  if(path==='/api/local/episode-commands'){
   expect(init?.method).toBe('POST');expect(new Headers(init?.headers).has('X-CSRF-Token')).toBe(false);
   const body=JSON.parse(String(init?.body)) as RequestData;posts.push(body);
   return Response.json(await (options.post?.(body)??workspace));
  }
  if(path==='/api/local/connections')return Response.json({serviceCatalog:{version:1,groups:[]}});
  throw Error('Unexpected native route: '+path);
 }));
 const command=(name:string,data:unknown)=>localCommand(name,data,undefined,'episode-commands');
 const view=render(<ProductionWorkspacePanel episodeId={episodeId} title="本地工程" scriptRevisionId="s" materials={[]} historicalReadOnly={options.readOnly} command={command} onLegacy={()=>{}}/>);
 return{posts,calls,...view};
}
it('moves tab focus within the native shadow root without searching the document',()=>{
 const host=document.body.appendChild(document.createElement('div')),root=host.attachShadow({mode:'open'}),container=root.appendChild(document.createElement('div')),onSelect=vi.fn();
 const view=render(<WorkspacePreparationSections completed={false} selected="visual" onSelect={onSelect}>{{visual:null,voice:null,sound:null}}</WorkspacePreparationSections>,{container});
 try{
  const tabs=within(container).getAllByRole('tab');act(()=>tabs[0].focus());fireEvent.keyDown(tabs[0],{key:'ArrowRight'});
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('voice');expect(root.activeElement).toBe(tabs[1]);
 }finally{view.unmount();host.remove();}
});
function operation(expectedRevision:number,op:Record<string,unknown>){return {command:'editWorkspaceStructure',idempotencyKey:expect.stringMatching(/^[a-f\d-]{36}$/i),data:{episodeId,workspaceId,expectedRevision,operation:op}};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

it('adds, keyboard-reorders, and confirms deletion with the original native revisioned command',async()=>{
 const {posts}=setup(saved([first,second]),{post:async({data})=>data.operation.kind==='insert'?saved([first,second,third],2):data.operation.kind==='move'?saved([first,third,second],3):saved([first,third],4)}),user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'新增镜头'}));
 const form=screen.getByRole('form',{name:'新增镜头'}),input=within(form).getByRole('textbox',{name:'新镜头文案'}),submit=within(form).getByRole('button',{name:'新增镜头'});
 await user.type(input,'  ');await user.click(submit);
 expect(within(form).getByRole('alert').textContent).toBe('请填写新镜头文案。');expect(document.activeElement).toBe(input);expect(posts).toHaveLength(0);
 fireEvent.change(input,{target:{value:third.text}});await user.click(submit);
 await screen.findByText('已在末尾新增镜头。');
 // The inserted form restores focus on the next frame; wait before navigating away.
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'新增镜头'})));
 const added=screen.getByRole('row',{name:'镜头 03'});act(()=>added.focus());await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
 await screen.findByText('shot-3 顺序已更新。');
 const remove=screen.getByRole('button',{name:'删除镜头 03'});await user.click(remove);
 let modal=screen.getByRole('dialog',{name:'删除镜头'});expect(modal.textContent).toContain(second.text);
 expect(posts).toHaveLength(2);await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await user.click(remove);modal=screen.getByRole('dialog',{name:'删除镜头'});await user.click(within(modal).getByRole('button',{name:'确认删除镜头'}));
 await waitFor(()=>expect(screen.queryByText(second.text)).toBeNull());
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'选择镜头 02'})));
 expect(posts).toEqual([operation(1,{kind:'insert',afterShotId:second.shotId,text:third.text}),operation(2,{kind:'move',shotId:third.shotId,beforeShotId:second.shotId}),operation(3,{kind:'remove',shotId:second.shotId})]);
});

async function changeTrim(){
 const user=userEvent.setup();
 const crop=await screen.findByRole('button',{name:'裁剪'});await user.click(crop);await user.click(screen.getByRole('button',{name:'精确时间'}));
 fireEvent.change(screen.getByRole('spinbutton',{name:'视频使用起点（秒）'}),{target:{value:'0.5'}});
 await user.click(screen.getByRole('button',{name:'精确时间'}));
 expect(screen.queryByRole('spinbutton',{name:'视频使用起点（秒）'})).toBeNull();
 const save=screen.getByRole('button',{name:'保存裁剪'});expect(save).toHaveProperty('disabled',true);
 await user.selectOptions(screen.getByRole('combobox',{name:'视觉候选时长处理'}),'use-candidate');
 expect(save).toHaveProperty('disabled',true);
 await user.click(screen.getByRole('checkbox',{name:'保留其他片段位置，接受空隙或覆盖'}));
 expect(save).toHaveProperty('disabled',false);return {save,crop};
}

it('trims the selected local video once using precise frame bounds and a freshly read revision',async()=>{
 const initial=saved([currentVideo,second]),fresh=deferred<ProductionWorkspace>();let reads=0;
 const {posts,calls,container}=setup(initial,{video:true,read:async()=>++reads===1?initial:fresh.promise,post:async()=>saved([currentVideo,second],3)});
 const {save,crop}=await changeTrim();
 const video=container.querySelector('video');expect(new URL(video!.getAttribute('src')!,'http://localhost').searchParams.get('path')).toBe(`/_local-artifact?episode=${episodeId}&path=${encodeURIComponent(sourcePath)}&sha256=${sourceSha}`);
 act(()=>{fireEvent.click(save);fireEvent.click(save);});
 expect(save).toHaveProperty('disabled',true);expect(posts).toHaveLength(0);expect(screen.queryByRole('button',{name:'拆分视频原声'})).toBeNull();
 await act(async()=>fresh.resolve(saved([currentVideo,second],2)));
 expect(await screen.findByText('裁剪已保存。')).toBeTruthy();expect(document.activeElement).toBe(crop);
 expect(calls.filter(path=>path===workRoute)).toHaveLength(2);
 expect(posts).toEqual([operation(2,{kind:'trim',itemId:first.itemId,sourceInFrame:15,sourceOutFrame:60,keepDuration:false})]);
});

it('does not submit a trim made against a superseded project or expose editing in historical read-only mode',async()=>{
 const initial=saved([currentVideo,second]);let reads=0;
 const {posts,unmount}=setup(initial,{video:true,read:async()=>++reads===1?initial:saved([currentVideo,second],2,'c'.repeat(64))});
 const {save}=await changeTrim();fireEvent.click(save);
 expect((await screen.findByRole('alert')).textContent).toBe('工程已变化，请刷新后重新裁剪。');expect(posts).toHaveLength(0);
 unmount();detach?.();
 const readonly=setup(initial,{video:true,readOnly:true});await screen.findByRole('button',{name:'选择镜头 01'});
 expect(screen.queryByRole('button',{name:'裁剪'})).toBeNull();expect(screen.queryByRole('button',{name:'新增镜头'})).toBeNull();expect(screen.queryByRole('button',{name:'删除镜头 01'})).toBeNull();expect(readonly.posts).toHaveLength(0);
});
