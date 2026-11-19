import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import userEvent from '@testing-library/user-event';
import {EmbeddedStudioHost} from './EmbeddedStudioHost';
const workspace={relativePath:'episodes/e/openchatcut-work/current/project.json',sha256:'a'.repeat(64),fileSize:42,projectId:'loop-control-e'};
afterEach(cleanup);
it('waits for the real frame flush before saving and rejects foreign messages',async()=>{
 const save=vi.fn(async()=>workspace),close=vi.fn();render(<EmbeddedStudioHost episodeId="e" title="隔离工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜'}]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement;
 const url=new URL(frame.src),channel=url.searchParams.get('lcChannel');
 expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(true);
 const state={type:'loop-control:state',writable:true,channel,projectId:'loop-control-e',items:[{id:'shot-S01-full',startFrame:0,durationInFrames:60}],selectedIds:[],revision:1};
 fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:9999',source:frame.contentWindow!,data:state}));
 expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:state}));
 const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.click(screen.getByRole('button',{name:'保存'}));
 expect(save).not.toHaveBeenCalled();const message=post.mock.calls.at(-1)![0] as Record<string,unknown>;expect(message.action).toBe('flush');
 fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{type:'loop-control:result',channel,projectId:'loop-control-e',requestId:message.requestId,ok:true}}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(workspace));expect(close).not.toHaveBeenCalled();expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);
});
it('keeps the editor open when its real flush fails and ignores a wrong channel',async()=>{
 const save=vi.fn(async()=>workspace),close=vi.fn();render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,channel:'wrong',revision:1,items:[],selectedIds:[]});
 expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(true);
 deliver({type:'loop-control:state',writable:true,revision:1,items:[],selectedIds:[]});
 const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const request=post.mock.calls.at(-1)![0] as Record<string,unknown>;
 deliver({type:'loop-control:result',requestId:request.requestId,ok:false,error:'保存失败，请重试。'});
 expect((await screen.findByRole('alert')).textContent).toContain('保存失败');
 expect(save).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBeTruthy();
});
it('does not load a frame for a mismatched project',()=>{
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/other',workspace:{...workspace,projectId:'other'},sourcePath:'episodes/e/board.json'}} shots={[]} onSave={async()=>workspace} onClose={()=>{}}/>);
 expect(screen.queryByTitle('OpenChatCut 剪辑工程')).toBeNull();expect(screen.getByRole('alert').textContent).toContain('身份不匹配');
});
it('uses the same flush and save boundary for the native home action',async()=>{
 const save=vi.fn(async()=>workspace),close=vi.fn();render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,revision:1,items:[],selectedIds:[]});
 const post=vi.spyOn(frame.contentWindow!,'postMessage');deliver({type:'loop-control:leave'});
 expect(post).toHaveBeenCalled();const request=post.mock.calls.at(-1)![0] as Record<string,unknown>;
 expect(request.action).toBe('flush');expect(close).not.toHaveBeenCalled();
 deliver({type:'loop-control:result',requestId:request.requestId,ok:true});await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save).toHaveBeenCalledWith(workspace);
});

it('uses the native timeline without a duplicate shot navigation',()=>{
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜'}]} onSave={async()=>workspace} onClose={()=>{}}/>);
 expect(screen.queryByRole('complementary',{name:'镜头导航'})).toBeNull();
 expect(screen.queryByRole('button',{name:'展开镜头导航'})).toBeNull();
 expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBeTruthy();
});

it('keeps the native frame and content actions locked until the real SDK write ownership is ready',()=>{
 const save=vi.fn(async()=>workspace);render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜'}]} onSave={save} onClose={()=>{}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');const deliver=(writable:boolean)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,type:'loop-control:state',revision:1,writable,items:[{id:'shot-S01-full',startFrame:0,durationInFrames:60}],selectedIds:[]}}));
 deliver(false);expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(true);expect(frame.hasAttribute('inert')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'保存'}));expect(post).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 deliver(true);expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(false);expect(frame.hasAttribute('inert')).toBe(false);deliver(false);expect(screen.getByText('编辑连接已变化，当前修改仍保留。请在最新窗口继续。')).toBeTruthy();expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(true);
});

it('does not treat a connected state without SDK ownership as write readiness',()=>{
 const save=vi.fn(async()=>workspace);render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜'}]} onSave={save} onClose={()=>{}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 const deliver=(writable:unknown)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,type:'loop-control:state',revision:1,writable,items:[{id:'shot-S01-full',startFrame:0,durationInFrames:60}],selectedIds:[]}}));
 for(const value of [undefined,'true',1,null]){deliver(value);expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(true);expect(frame.hasAttribute('inert')).toBe(true);}
 deliver(true);expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(false);expect(frame.hasAttribute('inert')).toBe(false);
 deliver(false);expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(true);expect(save).not.toHaveBeenCalled();
});
it('opens only requested supplementary tools without leaving the native editor',()=>{
 const tools=vi.fn((_bridge,kind)=><p>{kind==='audio'?'声音候选入口':'画面候选入口'}</p>),close=vi.fn();
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'project.json'}} shots={[]} onSave={async()=>workspace} onClose={close} renderTools={tools}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 expect(tools).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'补充工具'}));
 expect(screen.getByRole('region',{name:'补充工具'}).parentElement).toBe(frame.parentElement?.parentElement);
 fireEvent.keyDown(screen.getByRole('button',{name:'收起补充工具'}),{key:'Escape'});
 expect(screen.queryByRole('region',{name:'补充工具'})).toBeNull();expect(document.activeElement).toBe(screen.getByRole('button',{name:'补充工具'}));
 deliver({type:'loop-control:state',writable:true,revision:1,items:[],selectedIds:[]});deliver({type:'loop-control:import-requested',kind:'audio'});
 expect(screen.getByText('声音候选入口')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();expect(close).not.toHaveBeenCalled();expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);
});

it('ignores the retired subtitle-panel messages and returns the last selected shot after save',async()=>{
 const close=vi.fn(),save=vi.fn(async()=>workspace);
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,structureEnabled:true,revision:1,items:[{id:'second',kind:'video',startFrame:30,durationInFrames:30}],selectedIds:['second'],shots:[{id:'S02',text:'第二镜',timelineId:'timeline',itemIds:['second'],startFrame:30,durationInFrames:30,effective:true}]});
 deliver({type:'loop-control:caption-alignment-requested'});deliver({type:'loop-control:caption-library-closed'});
 expect(screen.queryByRole('button',{name:'自动校准字幕时间'})).toBeNull();expect(screen.queryByRole('button',{name:'关闭字幕对齐'})).toBeNull();expect(document.querySelector('.embedded-studio-caption-panel')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();expect(post).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'保存并返回分镜台'}));
 const request=post.mock.calls.at(-1)![0];expect(request.action).toBe('flush');expect(close).not.toHaveBeenCalled();
 deliver({type:'loop-control:result',requestId:request.requestId,ok:true});
 await waitFor(()=>expect(close).toHaveBeenCalledWith('preparation',{shotId:'S02',itemId:'second'}));
});

it('shows only the selected shot sound intent beside the native editor without adding an editing command',()=>{
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜',soundIntent:'开门时一声轻响'},{id:'S02',text:'第二镜',soundIntent:'结尾的钟声'}]} onSave={async()=>workspace} onClose={()=>{}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const state={channel,projectId:workspace.projectId,type:'loop-control:state',writable:true,revision:1,items:[{id:'first',startFrame:0,durationInFrames:60},{id:'second',startFrame:60,durationInFrames:60}],shots:[{id:'S01',itemIds:['first']},{id:'S02',itemIds:['second']}]};
 const select=(selectedIds:string[])=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{...state,selectedIds}}));
 select(['first']);expect(screen.getByLabelText('当前镜头音效意图').textContent).toContain('开门时一声轻响');expect(screen.queryByText('结尾的钟声')).toBeNull();
 select(['second']);expect(screen.getByLabelText('当前镜头音效意图').textContent).toContain('结尾的钟声');expect(screen.queryByText('开门时一声轻响')).toBeNull();
 select([]);expect(screen.queryByLabelText('当前镜头音效意图')).toBeNull();expect(post).not.toHaveBeenCalled();
});

it('exposes focus directly without a tools menu or duplicate audio panel',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>workspace),close=vi.fn();
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程'),focus=screen.getByRole('button',{name:'专注剪辑'});
 expect(screen.queryByRole('button',{name:'剪辑工具'})).toBeNull();expect(screen.queryByRole('menu')).toBeNull();expect(screen.queryByRole('region',{name:'音效调整'})).toBeNull();
 act(()=>focus.focus());await user.keyboard('{Enter}');expect(document.querySelector('.embedded-studio.is-focused')).toBeTruthy();expect(screen.getByRole('button',{name:'退出专注剪辑'})).toBe(focus);
 await user.keyboard('{Enter}');expect(document.querySelector('.embedded-studio.is-focused')).toBeNull();expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);expect(save).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
});
it('ends the leave intent when its host unmounts during Owner saving',async()=>{
 let finish!:(value:typeof workspace)=>void;
 const save=vi.fn(()=>new Promise<typeof workspace>(resolve=>{finish=resolve;})),close=vi.fn();
 const app=render(<EmbeddedStudioHost episodeId="e" title="旧访问" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'project.json'}} shots={[]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 const post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,revision:1,items:[],selectedIds:[]});fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const request=post.mock.calls.at(-1)![0];await act(async()=>deliver({type:'loop-control:result',requestId:request.requestId,ok:true}));
 expect(save).toHaveBeenCalledOnce();app.unmount();await act(async()=>finish(workspace));expect(close).not.toHaveBeenCalled();
});


it('keeps structural edits bound to the inspected native document and latest saved workspace',async()=>{
 let bridge!:import('./EmbeddedStudioHost').EmbeddedStudioBridge;
 const next={...workspace,sha256:'b'.repeat(64)},save=vi.fn(async(_file:unknown)=>next);
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'project.json'}} shots={[]} onSave={save} onClose={()=>{}} renderTools={value=>{bridge=value;return null;}}/>);
 fireEvent.click(screen.getByRole('button',{name:'补充工具'}));
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,structureEnabled:true,revision:1,items:[{id:'one',startFrame:0,durationInFrames:30},{id:'two',startFrame:30,durationInFrames:30}],selectedIds:['two'],shots:[{id:'S01',text:'第一镜',timelineId:'t',itemIds:['one'],startFrame:0,durationInFrames:30,effective:true},{id:'S02',text:'第二镜',timelineId:'t',itemIds:['two'],startFrame:30,durationInFrames:30,effective:true}]});
 for(let index=0;index<2;index++){
  void bridge.applyEdit({kind:'move',shotId:'S02',beforeShotId:'S01'});
  let request=post.mock.calls.at(-1)![0];expect(request.action).toBe('inspect');
  deliver({type:'loop-control:result',requestId:request.requestId,ok:true,result:{revision:index+1,documentFingerprint:'c'.repeat(64)}});
  await waitFor(()=>expect(post.mock.calls.at(-1)?.[0].action).toBe('apply-workspace-edit'));
  request=post.mock.calls.at(-1)![0];expect(request).toMatchObject({operation:{kind:'move',shotId:'S02',beforeShotId:'S01'},expectedRevision:index+1,expectedDocumentFingerprint:'c'.repeat(64)});
  deliver({type:'loop-control:result',requestId:request.requestId,ok:true,result:{document:{version:3}}});
  for(let flush=0;flush<2;flush++){await waitFor(()=>expect(post.mock.calls.at(-1)?.[0].action).toBe('flush'));const sent=post.mock.calls.at(-1)![0];await act(async()=>deliver({type:'loop-control:result',requestId:sent.requestId,ok:true}));}
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(index+1));await waitFor(()=>expect((screen.getByRole('button',{name:'保存'}) as HTMLButtonElement).disabled).toBe(false));
 }
 expect(save.mock.calls.map(call=>call[0])).toEqual([workspace,next]);
});

it('exposes native edits through inspect, checked apply and a real flush before returning',async()=>{
 let bridge!:import('./EmbeddedStudioHost').EmbeddedStudioBridge;
 const save=vi.fn(async()=>workspace);
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'project.json'}} shots={[]} onSave={save} onClose={()=>{}} renderTools={value=>{bridge=value;return null;}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,revision:4,items:[{id:'selected',startFrame:0,durationInFrames:30}],selectedIds:['selected'],shots:[{id:'S1',itemIds:['selected']}]});
 fireEvent.click(screen.getByRole('button',{name:'补充工具'}));expect(bridge.selectedItemId).toBe('selected');
 let result!:Promise<unknown>;act(()=>{result=bridge.applyNativeEdit('apply-candidate',{edit:{id:'candidate'}});});
 expect(post.mock.calls.at(-1)![0].action).toBe('inspect');
 await act(async()=>deliver({type:'loop-control:result',requestId:post.mock.calls.at(-1)![0].requestId,ok:true,result:{revision:4,documentFingerprint:'fingerprint',document:{}}}));
 expect(post.mock.calls.at(-1)![0]).toMatchObject({action:'apply-candidate',expectedRevision:4,expectedDocumentFingerprint:'fingerprint'});expect(save).not.toHaveBeenCalled();
 await act(async()=>deliver({type:'loop-control:result',requestId:post.mock.calls.at(-1)![0].requestId,ok:true,result:{document:{activeTimelineId:'real'}}}));
 expect(post.mock.calls.at(-1)![0].action).toBe('flush');expect(save).not.toHaveBeenCalled();
 await act(async()=>deliver({type:'loop-control:result',requestId:post.mock.calls.at(-1)![0].requestId,ok:true}));
 await expect(result).resolves.toEqual({activeTimelineId:'real'});expect(save).not.toHaveBeenCalled();
});
it('rejects a supplied document fingerprint if the editor has changed since preparation',async()=>{
 let bridge!:import('./EmbeddedStudioHost').EmbeddedStudioBridge;const save=vi.fn(async()=>workspace);
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'project.json'}} shots={[]} onSave={save} onClose={()=>{}} renderTools={value=>{bridge=value;return null;}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,revision:1,items:[],selectedIds:[]});fireEvent.click(screen.getByRole('button',{name:'补充工具'}));
 let failure!:Promise<unknown>;act(()=>{failure=bridge.applyNativeEdit('apply-audio-mix',{edit:{},expectedDocumentFingerprint:'prepared'}).catch(error=>error.message);});
 await act(async()=>deliver({type:'loop-control:result',requestId:post.mock.calls.at(-1)![0].requestId,ok:true,result:{revision:2,documentFingerprint:'new-manual-edit'}}));
 expect(await failure).toContain('已有新修改');expect(post.mock.calls).toHaveLength(1);expect(save).not.toHaveBeenCalled();
});
it('saves before the explicit delivery action and returns the selected shot',async()=>{
 const close=vi.fn(),save=vi.fn(async()=>workspace);render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'project.json'}} shots={[]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,revision:1,items:[{id:'selected',startFrame:0,durationInFrames:30}],selectedIds:['selected'],shots:[{id:'S1',itemIds:['selected']}]});fireEvent.click(screen.getByRole('button',{name:'生成成片'}));expect(close).not.toHaveBeenCalled();
 await act(async()=>deliver({type:'loop-control:result',requestId:post.mock.calls.at(-1)![0].requestId,ok:true}));expect(save).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledWith('delivery',{shotId:'S1',itemId:'selected'});
});
it('holds navigation and tool selection until the complete tool operation finishes while its bridge can still save',async()=>{
 let bridge!:import('./EmbeddedStudioHost').EmbeddedStudioBridge,reportBusy!:(busy:boolean)=>void;
 const save=vi.fn(async()=>workspace),close=vi.fn();
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'project.json'}} shots={[{id:'S1',text:'镜头'}]} onSave={save} onClose={close} renderTools={(value,target,_file,onBusyChange)=>{bridge=value;reportBusy=onBusyChange!;return <p>{target}候选工具</p>;}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,revision:1,items:[{id:'selected',startFrame:0,durationInFrames:30}],selectedIds:['selected'],shots:[{id:'S1',text:'镜头',itemIds:['selected']}]});fireEvent.click(screen.getByRole('button',{name:'补充工具'}));
 act(()=>reportBusy(true));
 for(const name of ['补充工具','画面与候选','字幕校时','保存','保存并返回分镜台','生成成片'])expect(screen.getByRole('button',{name})).toHaveProperty('disabled',true);
 expect(frame.hasAttribute('inert')).toBe(true);expect(bridge.connected).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'画面与候选'}));deliver({type:'loop-control:leave'});deliver({type:'loop-control:import-requested',kind:'visual'});expect(screen.getByText('audio候选工具')).toBeTruthy();expect(close).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled();
 let saved!:Promise<void>;act(()=>{saved=bridge.save();});expect(post.mock.calls.at(-1)![0].action).toBe('flush');
 await act(async()=>deliver({type:'loop-control:result',requestId:post.mock.calls.at(-1)![0].requestId,ok:true}));await saved;expect(save).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'画面与候选'})).toHaveProperty('disabled',true);
 act(()=>reportBusy(false));expect(frame.hasAttribute('inert')).toBe(false);expect(screen.getByRole('button',{name:'画面与候选'})).toHaveProperty('disabled',false);
});
