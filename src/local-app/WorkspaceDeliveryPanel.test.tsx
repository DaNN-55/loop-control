import {act,render,screen,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
vi.mock('./WorkspacePublicationPanel',()=>({WorkspacePublicationPanel:()=>null}));
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
const workspace=()=>({id:'workspace',episodeId:'episode',revision:7,stale:false,exports:[{id:'export',status:'ready',checks:[],current:true,confirmed:true,contentSha256:'confirmed-content',artifact:{sha256:'confirmed-video'}}]}) as unknown as ProductionWorkspace;
it('does not publish an older delivery poll after a newer workspace was provided',async()=>{
 vi.useFakeTimers();let reply!:(value:unknown)=>void;
 const w={...workspace(),deliveries:[{id:'delivery',status:'running'}]} as ProductionWorkspace;
 const received=vi.fn(),slow=new Promise(resolve=>{reply=resolve;});
 vi.stubGlobal('fetch',vi.fn(()=>slow.then(value=>Response.json(value))));
 const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={received}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(2500));
 const newer={...w,revision:8};view.rerender(<WorkspaceDeliveryPanel workspace={newer} pending={false} command={vi.fn()} onChange={received}/>);
 await act(async()=>reply({workspace:w}));
 expect(received).not.toHaveBeenCalled();
 vi.unstubAllGlobals();
});

it.each(['workspace','delivery','stopped','unmount'] as const)('ignores a late delivery reply after %s changes',async(change)=>{
 vi.useFakeTimers();let reply!:(value:Response)=>void;
 const w={...workspace(),deliveries:[{id:'original',status:'running'}]} as ProductionWorkspace,received=vi.fn();
 const read=vi.fn((_url:RequestInfo|URL,_options?:RequestInit)=>new Promise<Response>(resolve=>{reply=resolve;}));vi.stubGlobal('fetch',read);
 const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={received}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(2500));
 if(change==='unmount')view.unmount();
 else{
  const next={...w,...(change==='workspace'?{id:'replacement'}:{}),deliveries:[{id:change==='delivery'?'replacement':'original',status:change==='stopped'?'completed':'running'}]} as ProductionWorkspace;
  view.rerender(<WorkspaceDeliveryPanel workspace={next} pending={false} command={vi.fn()} onChange={received}/>);
 }
 await act(async()=>reply(Response.json({workspace:{...w,revision:99}})));
 expect(received).not.toHaveBeenCalled();expect(read.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it('ignores an old delivery error after same-revision authoritative state is provided',async()=>{
 vi.useFakeTimers();let reject!:(error:Error)=>void;
 const w={...workspace(),deliveries:[{id:'delivery',status:'running'}]} as ProductionWorkspace;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>((_resolve,fail)=>{reject=fail;})));
 const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={vi.fn()}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(2500));
 view.rerender(<WorkspaceDeliveryPanel workspace={{...w,exports:[{...w.exports![0],confirmed:false}]}} pending={false} command={vi.fn()} onChange={vi.fn()}/>);
 await act(async()=>reject(Error('old read failed')));
 expect(screen.queryByText('交付状态暂不可用，请刷新重试。')).toBeNull();
});

it('keeps same-revision supplied state when an older delivery reply arrives',async()=>{
 vi.useFakeTimers();let reply!:(value:Response)=>void;
 const w={...workspace(),deliveries:[{id:'delivery',status:'running'}]} as ProductionWorkspace,received=vi.fn();
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{reply=resolve;})));
 const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={received}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(2500));
 view.rerender(<WorkspaceDeliveryPanel workspace={{...w,exports:[{...w.exports![0],confirmed:false}]}} pending={false} command={vi.fn()} onChange={received}/>);
 await act(async()=>reply(Response.json({workspace:w})));
 expect(received).not.toHaveBeenCalled();
});

it('shows a current delivery read failure and can read again on the next polling tick',async()=>{
 vi.useFakeTimers();const w={...workspace(),deliveries:[{id:'delivery',status:'running'}]} as ProductionWorkspace,received=vi.fn();
 const read=vi.fn().mockResolvedValueOnce(Response.json({error:'unavailable'},{status:503})).mockResolvedValueOnce(Response.json({workspace:w}));vi.stubGlobal('fetch',read);
 render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={received}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(2500));expect(screen.getByText('交付状态暂不可用，请刷新重试。')).toBeTruthy();
 await act(async()=>vi.advanceTimersByTimeAsync(2500));expect(received).toHaveBeenCalledWith(w);expect(read).toHaveBeenCalledTimes(2);
});

it('keeps the 2500ms cadence and avoids overlapping delivery reads',async()=>{
 vi.useFakeTimers();let reply!:(value:Response)=>void;
 const w={...workspace(),deliveries:[{id:'delivery',status:'running'}]} as ProductionWorkspace;
 const read=vi.fn(()=>new Promise<Response>(resolve=>{reply=resolve;}));vi.stubGlobal('fetch',read);
 const received=vi.fn();render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={received}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(2499));expect(read).not.toHaveBeenCalled();
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(read).toHaveBeenCalledOnce();
 await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(read).toHaveBeenCalledOnce();
 await act(async()=>reply(Response.json({workspace:w})));expect(received).toHaveBeenCalledWith(w);
 await act(async()=>vi.advanceTimersByTimeAsync(2500));expect(read).toHaveBeenCalledTimes(2);
});

it('keeps verified file links bound to actual paths and hashes',()=>{
 const w=workspace();w.deliveries=[{id:'done',exportId:'export',status:'completed',verified:true,artifacts:[{artifactType:'final_render',relativePath:'episodes/episode/delivery/final.mp4',sha256:'actual-sha'}]}] as ProductionWorkspace['deliveries'];render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);const link=screen.getByRole('link',{name:'下载视频'});expect(link.getAttribute('href')).toContain('path=episodes%2Fepisode%2Fdelivery%2Ffinal.mp4&sha256=actual-sha');expect(screen.queryByRole('button',{name:'生成并验证交付包'})).toBeNull();
});

it('continues delivery polling when parent refreshes replace the callback',async()=>{
 vi.useFakeTimers();const w={...workspace(),deliveries:[{id:'d',status:'ready'}]} as ProductionWorkspace,finished={...w,deliveries:[{id:'d',exportId:'export',taskId:'task',status:'completed',verified:true,artifacts:[],error:null,createdAt:'2026-10-30T00:00:00Z'}]} as ProductionWorkspace;
 const read=vi.fn(async()=>Response.json({workspace:finished}));vi.stubGlobal('fetch',read);const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={vi.fn()}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(1000));view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={vi.fn()}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(1000));const latest=vi.fn();view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={latest}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(500));expect(latest).toHaveBeenCalledWith(finished);expect(read).toHaveBeenCalledWith('/api/local/episodes/episode/workspace',expect.objectContaining({signal:expect.any(AbortSignal)}));
});

it('pauses delivery polling in a hidden page and reads immediately when it becomes visible',async()=>{
 vi.useFakeTimers();let hidden=true;
 const visibility=vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 const w={...workspace(),deliveries:[{id:'delivery',status:'running'}]} as ProductionWorkspace;
 const read=vi.fn(async()=>Response.json({workspace:w}));vi.stubGlobal('fetch',read);
 render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(read).not.toHaveBeenCalled();
 hidden=false;await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(read).toHaveBeenCalledTimes(1);
 await act(async()=>vi.advanceTimersByTimeAsync(2500));expect(read).toHaveBeenCalledTimes(2);
 visibility.mockRestore();
});

it('waits for a pending delivery read before the visibility refresh and clears a recovered poll error',async()=>{
 vi.useFakeTimers();let hidden=false,finish!:(value:Response)=>void;
 vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 const w={...workspace(),deliveries:[{id:'delivery',status:'running'}]} as ProductionWorkspace;
 const read=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})).mockResolvedValueOnce(Response.json({error:'read failed'},{status:503})).mockImplementation(async()=>Response.json({workspace:w}));
 vi.stubGlobal('fetch',read);render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(2500));expect(read).toHaveBeenCalledTimes(1);
 hidden=true;act(()=>document.dispatchEvent(new Event('visibilitychange')));hidden=false;
 await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(read).toHaveBeenCalledTimes(1);
 await act(async()=>finish(Response.json({workspace:w})));expect(read).toHaveBeenCalledTimes(2);
 expect(screen.getByRole('alert').textContent).toBe('交付状态暂不可用，请刷新重试。');
 await act(async()=>vi.advanceTimersByTimeAsync(2500));expect(read).toHaveBeenCalledTimes(3);expect(screen.queryByRole('alert')).toBeNull();
});
