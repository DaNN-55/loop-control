import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {EmbeddedStudioHost} from './EmbeddedStudioHost';
const workspace={relativePath:'episodes/e/openchatcut-work/current/project.json',sha256:'a'.repeat(64),fileSize:42,projectId:'loop-control-e'};
afterEach(cleanup);
it('waits for the real frame flush before saving and rejects foreign messages',async()=>{
 const save=vi.fn(async()=>workspace),close=vi.fn();render(<EmbeddedStudioHost episodeId="e" title="隔离工程" session={{studioUrl:'http://127.0.0.1:5175/#/editor/loop-control-e',workspace,sourcePath:'episodes/e/board.json'}} shots={[{id:'S01',text:'第一镜'}]} onSave={save} onClose={close}/>);
 const frame=screen.getByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement;
 const url=new URL(frame.src),channel=url.searchParams.get('lcChannel');
 expect((screen.getByRole('button',{name:'保存工作版本'}) as HTMLButtonElement).disabled).toBe(true);
 const state={type:'loop-control:state',channel,projectId:'loop-control-e',items:[{id:'shot-S01-full',startFrame:0,durationInFrames:60}],selectedIds:[],revision:1};
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
 deliver({type:'loop-control:state',channel:'wrong',revision:1,items:[],selectedIds:[]});
 expect((screen.getByRole('button',{name:'返回生产单'}) as HTMLButtonElement).disabled).toBe(true);
 deliver({type:'loop-control:state',revision:1,items:[],selectedIds:[]});
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
 deliver({type:'loop-control:state',revision:1,items:[],selectedIds:[]});
 const post=vi.spyOn(frame.contentWindow!,'postMessage');deliver({type:'loop-control:leave'});
 expect(post).toHaveBeenCalled();const request=post.mock.calls.at(-1)![0] as Record<string,unknown>;
 expect(request.action).toBe('flush');expect(close).not.toHaveBeenCalled();
 deliver({type:'loop-control:result',requestId:request.requestId,ok:true});await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(save).toHaveBeenCalledWith(workspace);
});
