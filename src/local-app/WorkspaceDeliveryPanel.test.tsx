import {act,render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import {WorkspaceDraftProvider} from './WorkspaceDraft';
import type {ProductionWorkspace} from '../productionWorkspace';
const createObjectURL=vi.fn((_file:Blob)=> 'blob:cover-preview'),revokeObjectURL=vi.fn();
beforeEach(()=>{createObjectURL.mockClear();revokeObjectURL.mockClear();Object.defineProperty(URL,'createObjectURL',{configurable:true,value:createObjectURL});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revokeObjectURL});});
afterEach(()=>{cleanup();localStorage.clear();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
const pngBytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const pngFile=(name:string)=>new File([pngBytes],name,{type:'image/png'});
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
it('registers the selected real cover and binds delivery metadata to the confirmed export',async()=>{
 const w=workspace(),command=vi.fn(async()=>w);render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'晨光样片'}});fireEvent.change(screen.getByRole('textbox',{name:'标签'}),{target:{value:'山野，清晨'}});fireEvent.change(screen.getByRole('textbox',{name:'简介'}),{target:{value:'清晨山脊的光线。'}});
 const cover=pngFile('晨光封面.png');Object.defineProperty(cover,'arrayBuffer',{value:async()=>new Uint8Array([1,2,3]).buffer});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[cover]}});await screen.findByRole('img',{name:'交付封面预览'});expect(screen.getByText('晨光封面.png')).toBeTruthy();expect(screen.getByRole('img',{name:'交付封面预览'}).getAttribute('src')).toBe('blob:cover-preview');expect(screen.getByRole('button',{name:'替换封面'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'生成并验证交付包'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceDelivery',{episodeId:'episode',workspaceId:'workspace',expectedRevision:7,exportId:'export',expectedExportSha256:'confirmed-video',expectedContentSha256:'confirmed-content',title:'晨光样片',description:'清晨山脊的光线。',tags:['山野','清晨'],coverBase64:'AQID'}));
});
it('keeps metadata unavailable before confirmation and retains the retry action for the original failed delivery',async()=>{
 const w=workspace();w.exports![0].confirmed=false;const command=vi.fn(async()=>w);const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);expect(screen.queryByRole('textbox',{name:'标题'})).toBeNull();expect(screen.queryByRole('button',{name:'选择封面'})).toBeNull();expect(screen.getByText('确认这份成片后，再设置封面与发布文案。')).toBeTruthy();
 w.exports![0].confirmed=true;w.deliveries=[{id:'original-delivery',status:'failed',error:'文件校验失败，请重试。'}] as ProductionWorkspace['deliveries'];view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'重试原交付'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('retryWorkspaceDelivery',{episodeId:'episode',workspaceId:'workspace',expectedRevision:7,deliveryId:'original-delivery'}));
});
it('keeps verified file links bound to actual paths and hashes',()=>{
 const w=workspace();w.deliveries=[{id:'done',status:'completed',verified:true,artifacts:[{artifactType:'final_render',relativePath:'episodes/episode/delivery/final.mp4',sha256:'actual-sha'}]}] as ProductionWorkspace['deliveries'];render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);const link=screen.getByRole('link',{name:'下载最终视频'});expect(link.getAttribute('href')).toContain('path=episodes%2Fepisode%2Fdelivery%2Ffinal.mp4&sha256=actual-sha');expect(screen.queryByRole('button',{name:'生成并验证交付包'})).toBeNull();
});

it('releases cover preview URLs when replaced and on unmount, while leaving the real file selection intact',async()=>{
 const w=workspace(),view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);const first=pngFile('first.png'),second=pngFile('second.png');fireEvent.change(screen.getByLabelText('封面'),{target:{files:[first]}});await waitFor(()=>expect(createObjectURL).toHaveBeenLastCalledWith(first));fireEvent.change(screen.getByLabelText('封面'),{target:{files:[second]}});await waitFor(()=>expect(createObjectURL.mock.calls.at(-1)?.[0]).toBe(second));expect(revokeObjectURL).toHaveBeenCalledOnce();expect(screen.getByText('second.png')).toBeTruthy();view.unmount();expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('releases the preview while delivery runs and restores it with the existing draft after a failed attempt',async()=>{
 const w=workspace(),view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>),cover=pngFile('draft.png');fireEvent.change(screen.getByLabelText('封面'),{target:{files:[cover]}});await screen.findByRole('img',{name:'交付封面预览'});const running={...w,deliveries:[{id:'d',status:'ready'}]} as ProductionWorkspace;view.rerender(<WorkspaceDeliveryPanel workspace={running} pending={false} command={vi.fn()} onChange={()=>{}}/>);expect(revokeObjectURL).toHaveBeenCalledOnce();const failed={...w,deliveries:[{id:'d',status:'failed',error:'重试'}]} as ProductionWorkspace;view.rerender(<WorkspaceDeliveryPanel workspace={failed} pending={false} command={vi.fn()} onChange={()=>{}}/>);expect(createObjectURL).toHaveBeenCalledTimes(2);expect(screen.getByRole('img',{name:'交付封面预览'})).toBeTruthy();expect(screen.getByText('draft.png')).toBeTruthy();
});

it('continues delivery polling when parent refreshes replace the callback',async()=>{
 vi.useFakeTimers();const w={...workspace(),deliveries:[{id:'d',status:'ready'}]} as ProductionWorkspace,finished={...w,deliveries:[{id:'d',exportId:'export',taskId:'task',status:'completed',verified:true,artifacts:[],error:null,createdAt:'2026-10-30T00:00:00Z'}]} as ProductionWorkspace;
 const read=vi.fn(async()=>Response.json({workspace:finished}));vi.stubGlobal('fetch',read);const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={vi.fn()}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(1000));view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={vi.fn()}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(1000));const latest=vi.fn();view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={latest}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(500));expect(latest).toHaveBeenCalledWith(finished);expect(read).toHaveBeenCalledWith('/api/local/episodes/episode/workspace',expect.objectContaining({signal:expect.any(AbortSignal)}));
});

 it('renders publishable metadata and hides raw technical files while providing real downloads',async()=>{
 const w=workspace();w.deliveries=[{id:'d',status:'completed',verified:true,artifacts:['cover','metadata','editable_project','final_qc_report'].map(artifactType=>({artifactType,relativePath:`${artifactType}.json`,sha256:'frozen',fileSize:10}))}] as ProductionWorkspace['deliveries'];
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({title:'发布标题',description:'发布简介',tags:['##清晨','＃产品']})));const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 render(<WorkspaceDeliveryPanel workspace={w} pending={true} command={vi.fn()} onChange={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'发布标题'})).toBeTruthy();expect(screen.getByText('发布简介')).toBeTruthy();expect(screen.getByText('#清晨 #产品')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'复制简介'}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith('发布简介'));
 expect(screen.getByRole('link',{name:'下载可编辑工程'}).getAttribute('href')).toContain('download=1');expect(screen.getByRole('link',{name:'下载全部交付文件（ZIP）'})).toBeTruthy();expect(document.querySelector('.workspace-delivery-technical')).toBeNull();expect(screen.queryByText('下载检查证据')).toBeNull();expect(screen.getByRole('button',{name:'复制标题'}).textContent).toBe('');expect(screen.getByRole('img',{name:'交付封面'})).toBeTruthy();vi.unstubAllGlobals();
});

it('restores non-secret delivery text after reopening but requires the cover file again',()=>{
 const w=workspace(),command=vi.fn(),renderPanel=()=>render(<WorkspaceDraftProvider ownerId="delivery-owner"><WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/></WorkspaceDraftProvider>);
 const view=renderPanel();fireEvent.change(screen.getByLabelText('标题'),{target:{value:'未提交标题'}});fireEvent.change(screen.getByLabelText('简介'),{target:{value:'未提交简介'}});fireEvent.change(screen.getByLabelText('标签'),{target:{value:'清晨,自然'}});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[pngFile('封面.png')]}});view.unmount();renderPanel();
 expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('未提交标题');expect((screen.getByLabelText('简介') as HTMLTextAreaElement).value).toBe('未提交简介');expect((screen.getByLabelText('标签') as HTMLInputElement).value).toBe('清晨,自然');expect(screen.getByText('请重新选择封面：封面.png')).toBeTruthy();expect(screen.queryByRole('img',{name:'交付封面预览'})).toBeNull();expect((screen.getByRole('button',{name:'生成并验证交付包'}) as HTMLButtonElement).disabled).toBe(true);expect(command).not.toHaveBeenCalled();
});
it('keeps text entered during a delivery request and clears only the successfully submitted draft',async()=>{
 const w=workspace();let finish!:(w:ProductionWorkspace)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));
 const view=render(<WorkspaceDraftProvider ownerId="pending-owner"><WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/></WorkspaceDraftProvider>);
 fireEvent.change(screen.getByLabelText('标题'),{target:{value:'请求中的标题'}});const cover=pngFile('cover.png');Object.defineProperty(cover,'arrayBuffer',{value:async()=>new Uint8Array([1]).buffer});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[cover]}});await screen.findByRole('img',{name:'交付封面预览'});fireEvent.click(screen.getByRole('button',{name:'生成并验证交付包'}));await waitFor(()=>expect(command).toHaveBeenCalledOnce());fireEvent.change(screen.getByLabelText('标题'),{target:{value:'请求后继续填写'}});await act(async()=>finish(w));view.unmount();
 render(<WorkspaceDraftProvider ownerId="pending-owner"><WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/></WorkspaceDraftProvider>);expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('请求后继续填写');
});
it('does not carry a live cover file into another export even when its recovered filename matches',async()=>{
 const first=workspace(),second={...workspace(),exports:[{...workspace().exports![0],id:'another-export'}]},command=vi.fn(),panel=(w:ProductionWorkspace)=><WorkspaceDraftProvider ownerId="export-owner"><WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/></WorkspaceDraftProvider>;
 const saved=render(panel(second));fireEvent.change(screen.getByLabelText('标题'),{target:{value:'另一导出草稿'}});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[pngFile('same-name.png')]}});saved.unmount();const current=render(panel(first));fireEvent.change(screen.getByLabelText('封面'),{target:{files:[pngFile('same-name.png')]}});expect(await screen.findByRole('img',{name:'交付封面预览'})).toBeTruthy();current.rerender(panel(second));expect(screen.queryByRole('img',{name:'交付封面预览'})).toBeNull();expect(screen.getByText('请重新选择封面：same-name.png')).toBeTruthy();
});

it('rejects empty, oversized and disguised covers before reading the full file, with a field error',async()=>{
 render(<WorkspaceDeliveryPanel workspace={workspace()} pending={false} command={vi.fn()} onChange={()=>{}}/>);
 for(const [file,message] of [[new File([],'empty.png',{type:'image/png'}),'封面为空'],[new File(['x'],'large.png',{type:'image/png'}),'20 MB'],[new File(['not an image'],'fake.png',{type:'image/png'}),'JPG、PNG 或 WebP']] as const){
  if(file.name==='large.png')Object.defineProperty(file,'size',{value:20*1024*1024+1});const fullRead=vi.fn();Object.defineProperty(file,'arrayBuffer',{value:fullRead});
  fireEvent.change(screen.getByLabelText('封面'),{target:{files:[file]}});const error=await screen.findByRole('alert');expect(error.textContent).toContain(message);expect(screen.getByLabelText('封面').getAttribute('aria-describedby')).toContain(error.id);expect(fullRead).not.toHaveBeenCalled();expect(screen.queryByRole('img',{name:'交付封面预览'})).toBeNull();
 }
});

it('normalizes leading hashes and validates tag limits before submitting the cover bytes',async()=>{
 const w=workspace(),command=vi.fn(async()=>w);render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('标题'),{target:{value:'标签边界'}});const cover=pngFile('tags.png'),fullRead=vi.fn(async()=>pngBytes.buffer);Object.defineProperty(cover,'arrayBuffer',{value:fullRead});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[cover]}});await screen.findByRole('img',{name:'交付封面预览'});
 for(const [tags,message] of [[Array.from({length:21},(_,i)=>`t${i}`).join(','),'最多 20 个'],['字'.repeat(51),'最多 50 个字符'],['#，正常','不能为空']] as const){fireEvent.change(screen.getByLabelText('标签'),{target:{value:tags}});fireEvent.click(screen.getByRole('button',{name:'生成并验证交付包'}));expect((await screen.findByRole('alert')).textContent).toContain(message);expect(fullRead).not.toHaveBeenCalled();expect(command).not.toHaveBeenCalled();}
 fireEvent.change(screen.getByLabelText('标签'),{target:{value:'#清晨， ##山野, ＃自然，C#'}});fireEvent.click(screen.getByRole('button',{name:'生成并验证交付包'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceDelivery',expect.objectContaining({tags:['清晨','山野','自然','C#']})));
});

it('retains a replacement cover with the same filename while the previous delivery is submitted',async()=>{
 const w=workspace();let finish!:(w:ProductionWorkspace)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('标题'),{target:{value:'封面替换'}});const first=pngFile('same.png');Object.defineProperty(first,'arrayBuffer',{value:async()=>pngBytes.buffer});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[first]}});await screen.findByRole('img',{name:'交付封面预览'});fireEvent.click(screen.getByRole('button',{name:'生成并验证交付包'}));await waitFor(()=>expect(command).toHaveBeenCalledOnce());
 const replacement=pngFile('same.png');fireEvent.change(screen.getByLabelText('封面'),{target:{files:[replacement]}});await waitFor(()=>expect(createObjectURL.mock.calls.at(-1)?.[0]).toBe(replacement));await act(async()=>finish(w));expect(screen.getByRole('img',{name:'交付封面预览'})).toBeTruthy();expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('封面替换');
});

it('hides a stale confirmed export and preserves the draft when its current confirmation returns',async()=>{
 const w=workspace(),command=vi.fn(),view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'保留这份交付文案'}});const cover=pngFile('keep.png');fireEvent.change(screen.getByLabelText('封面'),{target:{files:[cover]}});await screen.findByRole('img',{name:'交付封面预览'});
 const stale={...w,exports:[{...w.exports![0],current:false,confirmed:true}]};view.rerender(<WorkspaceDeliveryPanel workspace={stale} pending={false} command={command} onChange={()=>{}}/>);expect(screen.queryByRole('textbox',{name:'标题'})).toBeNull();expect(screen.queryByRole('button',{name:'生成并验证交付包'})).toBeNull();expect(screen.getByText('工程已变化，请重新导出并确认成片。')).toBeTruthy();expect(revokeObjectURL).toHaveBeenCalled();expect(command).not.toHaveBeenCalled();
 view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);expect((screen.getByRole('textbox',{name:'标题'})as HTMLInputElement).value).toBe('保留这份交付文案');expect(screen.getByText('keep.png')).toBeTruthy();await screen.findByRole('img',{name:'交付封面预览'});
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
