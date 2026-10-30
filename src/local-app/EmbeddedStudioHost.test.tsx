import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {EmbeddedStudioHost} from './EmbeddedStudioHost';
const workspace={relativePath:'episodes/e/openchatcut-work/current/project.json',sha256:'a'.repeat(64),fileSize:42,projectId:'loop-control-e'};
afterEach(cleanup);
it('waits for the real frame flush before saving and rejects foreign messages',async()=>{
 const save=vi.fn(async()=>workspace),close=vi.fn();render(<EmbeddedStudioHost episodeId="e" title="隔离工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜'}]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement;
 const url=new URL(frame.src),channel=url.searchParams.get('lcChannel');
 expect((screen.getByRole('button',{name:'保存工作版本'}) as HTMLButtonElement).disabled).toBe(true);
 const state={type:'loop-control:state',writable:true,channel,projectId:'loop-control-e',items:[{id:'shot-S01-full',startFrame:0,durationInFrames:60}],selectedIds:[],revision:1};
 fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:9999',source:frame.contentWindow!,data:state}));
 expect((screen.getByRole('button',{name:'保存工作版本'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:state}));
 const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.click(screen.getByRole('button',{name:'保存工作版本'}));
 expect(save).not.toHaveBeenCalled();const message=post.mock.calls.at(-1)![0] as Record<string,unknown>;expect(message.action).toBe('flush');
 fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{type:'loop-control:result',channel,projectId:'loop-control-e',requestId:message.requestId,ok:true}}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(workspace));expect(close).not.toHaveBeenCalled();
});
it('keeps the editor open when its real flush fails and ignores a wrong channel',async()=>{
 const save=vi.fn(async()=>workspace),close=vi.fn();render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,channel:'wrong',revision:1,items:[],selectedIds:[]});
 expect((screen.getByRole('button',{name:'返回生产单'}) as HTMLButtonElement).disabled).toBe(true);
 deliver({type:'loop-control:state',writable:true,revision:1,items:[],selectedIds:[]});
 const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.click(screen.getByRole('button',{name:'返回生产单'}));
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
it('binds incremental caption edits to the inspected live document before flush and save',async()=>{
 let bridge:import('./EmbeddedStudioHost').EmbeddedStudioBridge|null=null;
 const save=vi.fn(async()=>workspace);
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={save} onClose={()=>{}} captionEditor={value=>{bridge=value;return null;}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,revision:3,items:[],selectedIds:[]});
 const post=vi.spyOn(frame.contentWindow!,'postMessage');const contract=(await import('../shotCaptions')).defaultShotCaptionContract('正文','independent');
 let promise:Promise<unknown>;act(()=>{promise=bridge!.applyCaptions('target',contract);});await waitFor(()=>expect(post.mock.calls.at(-1)?.[0].action).toBe('inspect'));
 let request=post.mock.calls.at(-1)![0];deliver({type:'loop-control:result',requestId:request.requestId,ok:true,result:{revision:3,documentFingerprint:'c'.repeat(64)}});
 await waitFor(()=>expect(post.mock.calls.at(-1)?.[0].action).toBe('apply-captions'));request=post.mock.calls.at(-1)![0];expect(request.expectedRevision).toBe(3);expect(request.expectedDocumentFingerprint).toBe('c'.repeat(64));expect(request.itemId).toBe('target');
 await act(async()=>{deliver({type:'loop-control:result',requestId:request.requestId,ok:false,error:'工程已有新修改，请重试。'});await expect(promise!).rejects.toThrow('已有新修改');});expect(save).not.toHaveBeenCalled();
});
it('keeps shot navigation available after collapsing the rail',()=>{
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜的完整简介'},{id:'S02',text:'第二镜'}]} onSave={async()=>workspace} onClose={()=>{}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,type:'loop-control:state',writable:true,revision:1,items:[{id:'shot-S01-full',startFrame:0,durationInFrames:60},{id:'shot-S02-full',startFrame:60,durationInFrames:60}],selectedIds:[]}}));
 fireEvent.click(screen.getByRole('button',{name:'折叠镜头导航'}));
 const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.click(screen.getByRole('button',{name:'定位镜头 S02'}));expect(post.mock.calls.at(-1)![0].itemId).toBe('shot-S02-full');
 expect(screen.getByRole('button',{name:'展开镜头导航'})).toBeTruthy();
});
it('uses the latest persisted file when a caller reuses its bridge for a save then a native edit',async()=>{
 let current:import('./EmbeddedStudioHost').EmbeddedStudioBridge|null=null;
 const next={...workspace,sha256:'b'.repeat(64)},save=vi.fn(async(_file:import('../reviews/reviewRevision').OpenChatCutStudioWorkspace)=>next);
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={save} onClose={()=>{}} captionEditor={value=>{current=value;return null;}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,revision:1,items:[],selectedIds:[]});const oldBridge=current!;
 let first:Promise<unknown>;act(()=>{first=oldBridge.save();});const flush=post.mock.calls.at(-1)![0];await act(async()=>{deliver({type:'loop-control:result',requestId:flush.requestId,ok:true});await first!;});
 let second:Promise<unknown>;act(()=>{second=oldBridge.applyNativeEdit('apply-candidate',{candidateId:'accepted'});});const inspect=post.mock.calls.at(-1)![0];deliver({type:'loop-control:result',requestId:inspect.requestId,ok:true,result:{revision:2,documentFingerprint:'c'.repeat(64)}});
 await waitFor(()=>expect(post.mock.calls.at(-1)?.[0].action).toBe('apply-candidate'));const edit=post.mock.calls.at(-1)![0];await act(async()=>{deliver({type:'loop-control:result',requestId:edit.requestId,ok:true,result:{document:{version:3}}});await second!;});expect(save.mock.calls.map(call=>call[0])).toEqual([workspace,next]);
});
it('keeps the native frame and content actions locked until the real SDK write ownership is ready',()=>{
 const save=vi.fn(async()=>workspace);render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜'}]} onSave={save} onClose={()=>{}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');const deliver=(writable:boolean)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,type:'loop-control:state',revision:1,writable,items:[{id:'shot-S01-full',startFrame:0,durationInFrames:60}],selectedIds:[]}}));
 deliver(false);expect((screen.getByRole('button',{name:'保存工作版本'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'定位镜头 S01'}) as HTMLButtonElement).disabled).toBe(true);expect(frame.hasAttribute('inert')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'保存工作版本'}));expect(post).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 deliver(true);expect((screen.getByRole('button',{name:'保存工作版本'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByRole('button',{name:'定位镜头 S01'}) as HTMLButtonElement).disabled).toBe(false);expect(frame.hasAttribute('inert')).toBe(false);deliver(false);expect(screen.getByText('编辑连接已变化，当前修改仍保留。请在最新窗口继续。')).toBeTruthy();expect((screen.getByRole('button',{name:'保存工作版本'}) as HTMLButtonElement).disabled).toBe(true);
});

it('does not treat a connected state without SDK ownership as write readiness',async()=>{
 let bridge:import('./EmbeddedStudioHost').EmbeddedStudioBridge|null=null;
 const save=vi.fn(async()=>workspace);render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜'}]} onSave={save} onClose={()=>{}} captionEditor={value=>{bridge=value;return null;}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(writable:unknown)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,type:'loop-control:state',revision:1,writable,items:[{id:'shot-S01-full',startFrame:0,durationInFrames:60}],selectedIds:[]}}));
 for(const value of [undefined,'true',1,null]){deliver(value);expect((screen.getByRole('button',{name:'保存工作版本'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'定位镜头 S01'}) as HTMLButtonElement).disabled).toBe(true);expect(frame.hasAttribute('inert')).toBe(true);expect(bridge!.connected).toBe(false);}
 let inspected:Promise<unknown>;act(()=>{inspected=bridge!.inspect();});const request=post.mock.calls.at(-1)![0];expect(request.action).toBe('inspect');
 await act(async()=>{fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,type:'loop-control:result',requestId:request.requestId,ok:true,result:{revision:1,documentFingerprint:'c'.repeat(64),document:{}}}}));await inspected!;});expect(save).not.toHaveBeenCalled();
 deliver(true);expect(bridge!.connected).toBe(true);expect(frame.hasAttribute('inert')).toBe(false);
});
it('redirects native file imports to the registered Host tools only after true SDK write readiness',()=>{
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={async()=>workspace} onClose={()=>{}} panels={[{id:'visuals',label:'画面版本',render:()=> <p>Owner 登记画面入口</p>},{id:'audio',label:'混音',render:()=> <p>Owner 声音素材入口</p>}]}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel'),deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:import-requested',kind:'visual'});expect(screen.queryByText('Owner 登记画面入口')).toBeNull();
 deliver({type:'loop-control:state',writable:true,revision:1,items:[],selectedIds:[]});deliver({type:'loop-control:import-requested',kind:'visual'});expect(screen.getByText('Owner 登记画面入口')).toBeTruthy();deliver({type:'loop-control:import-requested',kind:'audio'});expect(screen.getByText('Owner 声音素材入口')).toBeTruthy();
});

it('starts with supplemental tools closed and preserves the native frame while tools toggle',async()=>{
 const save=vi.fn(async()=>workspace);render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={save} onClose={()=>{}} panels={[{id:'visuals',label:'画面版本',render:()=> <p>生成与版本</p>}]} captionEditor={()=> <p>对齐工具</p>}/>);
 expect(screen.queryByRole('tab',{name:'画面版本'})).toBeNull();
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,channel=new URL(frame.src).searchParams.get('lcChannel');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 deliver({type:'loop-control:state',writable:true,structureEnabled:true,revision:1,items:[],selectedIds:[]});
 const post=vi.spyOn(frame.contentWindow!,'postMessage');fireEvent.click(screen.getByRole('button',{name:'生成、版本与对齐'}));let request=post.mock.calls.at(-1)![0];expect(request.action).toBe('host-panel');expect(request.open).toBe(true);deliver({type:'loop-control:result',requestId:request.requestId,ok:true});
 await screen.findByRole('tab',{name:'画面版本'});expect(screen.queryByRole('tab',{name:'字幕'})).toBeNull();expect(screen.getByRole('tab',{name:'字幕对齐'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'收起补充工具'}));request=post.mock.calls.at(-1)![0];expect(request.open).toBe(false);deliver({type:'loop-control:result',requestId:request.requestId,ok:true});await waitFor(()=>expect(screen.queryByRole('tab',{name:'画面版本'})).toBeNull());expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);expect(save).not.toHaveBeenCalled();
});
it('moves only platform shot settings into closed supplemental tools without replacing the native frame',async()=>{
 render(<EmbeddedStudioHost episodeId="e" title="工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[]} onSave={async()=>workspace} onClose={()=>{}}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,canvas=frame.parentElement!,channel=new URL(frame.src).searchParams.get('lcChannel'),post=vi.spyOn(frame.contentWindow!,'postMessage');
 const deliver=(data:Record<string,unknown>)=>fireEvent(window,new MessageEvent('message',{origin:'http://127.0.0.1:5175',source:frame.contentWindow!,data:{channel,projectId:workspace.projectId,...data}}));
 const items=[{id:'first',kind:'video',startFrame:0,durationInFrames:30},{id:'second',kind:'video',startFrame:30,durationInFrames:30}];
 const state={type:'loop-control:state',writable:true,structureEnabled:true,revision:1,items,selectedIds:['first'],shots:[{id:'S01',text:'第一镜',timelineId:'timeline',itemIds:['first','second'],startFrame:0,durationInFrames:60,effective:true}]};
 deliver(state);
 expect(canvas.firstElementChild).toBe(frame);expect(canvas.querySelector('.workspace-native-controls')).toBeNull();expect(screen.queryByRole('tab',{name:'镜头设置'})).toBeNull();expect(screen.queryByRole('checkbox',{name:'保留片段时长'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'生成、版本与对齐'}));let request=post.mock.calls.at(-1)![0];deliver({type:'loop-control:result',requestId:request.requestId,ok:true});
 await screen.findByRole('tab',{name:'镜头设置'});expect(screen.getByRole('checkbox',{name:'保留片段时长'})).toBeTruthy();expect(screen.getByRole('combobox',{name:'镜头构图布局'})).toBeTruthy();expect(screen.queryByRole('combobox',{name:'当前画面片段'})).toBeNull();expect(screen.queryByRole('button',{name:'源起点减少一帧'})).toBeNull();expect(screen.queryByRole('combobox',{name:'画面填充'})).toBeNull();expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);
 fireEvent.click(screen.getByRole('button',{name:'收起补充工具'}));request=post.mock.calls.at(-1)![0];deliver({type:'loop-control:result',requestId:request.requestId,ok:true});await waitFor(()=>expect(screen.queryByRole('tab',{name:'镜头设置'})).toBeNull());expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);
 deliver({...state,revision:2,selectedIds:[]});expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);
});
