import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CompletedStudioView} from './CompletedStudioView';
import {WorkspaceDraftProvider,useWorkspaceDraftLeave} from './WorkspaceDraft';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('./client',()=>({localRequest:request}));
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;fireEvent(this,new Event('close'));}});});
afterEach(()=>{cleanup();vi.restoreAllMocks();request.mockReset();});
it('opens an isolated copy through its own API and can return when its temporary session has already closed',async()=>{
 request.mockImplementation(async(_path:string,init?:RequestInit)=>{
  const {copyId,action}=JSON.parse(String(init?.body));
  if(action==='discard')throw Object.assign(Error('副本已关闭'),{status:404});
  return action==='open'?{copyId,sourceSha256:'frozen',studioUrl:`http://127.0.0.1:5678/?lcBridge=1#/editor/loop-control-${copyId}`,workspace:{projectId:'loop-control-'+copyId,relativePath:'copy.json',sha256:'sha',fileSize:1},sourcePath:'copy.json'}:{closed:true};
 });
 const closed=vi.fn();const {container}=render(<CompletedStudioView episodeId="episode" title="已完成" onClose={closed}/>);
 const iframe=await screen.findByTitle('OpenChatCut 查看副本');
 expect((iframe as HTMLIFrameElement).src).toContain('lcProject=loop-control-');
 expect(screen.getByText('查看副本，修改不会影响已完成生产单。')).toBeTruthy();
 expect(container.querySelector('.completed-project-viewer')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'返回分镜台'}));
 await waitFor(()=>expect(closed).toHaveBeenCalled());
 expect(request.mock.calls.every(([path])=>path==='episodes/episode/studio-copy')).toBe(true);
});

it('keeps edits inside the copy, guards external navigation, and saves before discarding the temporary session',async()=>{
 const actions:string[]=[],navigated=vi.fn();
 request.mockImplementation(async(_path:string,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));actions.push(body.action);return body.action==='open'?{copyId:body.copyId,sourceSha256:'frozen',studioUrl:`http://127.0.0.1:5678/?lcBridge=1#/editor/loop-control-${body.copyId}`,workspace:{projectId:'loop-control-'+body.copyId,relativePath:'copy.json',sha256:'sha',fileSize:1},sourcePath:'copy.json'}:{closed:true};});
 function Leave(){const leave=useWorkspaceDraftLeave();return <button onClick={()=>leave(navigated)}>离开生产单</button>;}
 render(<WorkspaceDraftProvider><Leave/><CompletedStudioView episodeId="episode" title="已完成" onClose={()=>{}}/></WorkspaceDraftProvider>);
 const iframe=await screen.findByTitle('OpenChatCut 查看副本') as HTMLIFrameElement,url=new URL(iframe.src),win=iframe.contentWindow!,channel=url.searchParams.get('lcChannel'),projectId=url.searchParams.get('lcProject');
 await act(async()=>{});
 const document={timelines:[{width:1080,selectedId:null}]};
 vi.spyOn(win,'postMessage').mockImplementation((message)=>{const data=message as {requestId:string;action:string};queueMicrotask(()=>fireEvent(window,new MessageEvent('message',{source:win,origin:url.origin,data:{type:'loop-control:result',channel,projectId,requestId:data.requestId,ok:true,result:data.action==='inspect'?{document:structuredClone(document)}:undefined}})));});
 fireEvent(window,new MessageEvent('message',{source:win,origin:'http://127.0.0.1:9999',data:{type:'loop-control:state',channel,projectId,writable:true}}));
 expect((screen.getByRole('button',{name:'另存为独立工程'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent(window,new MessageEvent('message',{source:win,origin:url.origin,data:{type:'loop-control:state',channel,projectId,writable:true}}));
 await waitFor(()=>expect((screen.getByRole('button',{name:'另存为独立工程'}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent(window,new MessageEvent('message',{source:win,origin:url.origin,data:{type:'loop-control:closed',channel,projectId}}));
 expect(screen.getByRole('alert').textContent).toContain('可另存已自动保存');
 fireEvent(window,new MessageEvent('message',{source:win,origin:url.origin,data:{type:'loop-control:state',channel,projectId,writable:true}}));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 document.timelines[0].width=720;fireEvent.click(screen.getByRole('button',{name:'离开生产单'}));
 const dialog=await screen.findByRole('dialog',{name:'保留这次修改？'});expect(navigated).not.toHaveBeenCalled();expect(actions).toEqual(['open']);
 fireEvent.click(within(dialog).getByRole('button',{name:'继续查看'}));expect(navigated).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'离开生产单'}));
 fireEvent.click(within(await screen.findByRole('dialog',{name:'保留这次修改？'})).getByRole('button',{name:'另存为独立工程'}));
 await waitFor(()=>expect(navigated).toHaveBeenCalledOnce());expect(actions).toEqual(['open','keep','discard']);
});
