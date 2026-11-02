import {act,render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {WorkspaceDeliveryPanel} from './WorkspaceDeliveryPanel';
import {WorkspaceDraftProvider} from './WorkspaceDraft';
import type {ProductionWorkspace} from '../productionWorkspace';
vi.mock('./client',()=>({localRequest:vi.fn()}));
import {localRequest} from './client';
const createObjectURL=vi.fn(()=> 'blob:cover-preview'),revokeObjectURL=vi.fn();
beforeEach(()=>{createObjectURL.mockClear();revokeObjectURL.mockClear();Object.defineProperty(URL,'createObjectURL',{configurable:true,value:createObjectURL});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revokeObjectURL});});
afterEach(()=>{cleanup();localStorage.clear();vi.useRealTimers();});
const workspace=()=>({id:'workspace',episodeId:'episode',revision:7,stale:false,exports:[{id:'export',confirmed:true,contentSha256:'confirmed-content',artifact:{sha256:'confirmed-video'}}]}) as unknown as ProductionWorkspace;
it('registers the selected real cover and binds delivery metadata to the confirmed export',async()=>{
 const w=workspace(),command=vi.fn(async()=>w);render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'标题'}),{target:{value:'晨光样片'}});fireEvent.change(screen.getByRole('textbox',{name:'标签'}),{target:{value:'山野，清晨'}});fireEvent.change(screen.getByRole('textbox',{name:'简介'}),{target:{value:'清晨山脊的光线。'}});
 const cover=new File([new Uint8Array([1,2,3])],'晨光封面.png',{type:'image/png'});Object.defineProperty(cover,'arrayBuffer',{value:async()=>new Uint8Array([1,2,3]).buffer});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[cover]}});expect(screen.getByText('晨光封面.png')).toBeTruthy();expect(screen.getByRole('img',{name:'交付封面预览'}).getAttribute('src')).toBe('blob:cover-preview');expect(screen.getByRole('button',{name:'替换封面'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'生成并验证交付包'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('prepareWorkspaceDelivery',{episodeId:'episode',workspaceId:'workspace',expectedRevision:7,exportId:'export',expectedExportSha256:'confirmed-video',expectedContentSha256:'confirmed-content',title:'晨光样片',description:'清晨山脊的光线。',tags:['山野','清晨'],coverBase64:'AQID'}));
});
it('keeps metadata unavailable before confirmation and retains the retry action for the original failed delivery',async()=>{
 const w=workspace();w.exports![0].confirmed=false;const command=vi.fn(async()=>w);const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);expect((screen.getByRole('textbox',{name:'标题'}) as HTMLInputElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'选择封面'}) as HTMLButtonElement).disabled).toBe(true);
 w.exports![0].confirmed=true;w.deliveries=[{id:'original-delivery',status:'failed',error:'文件校验失败，请重试。'}] as ProductionWorkspace['deliveries'];view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'重试原交付'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('retryWorkspaceDelivery',{episodeId:'episode',workspaceId:'workspace',expectedRevision:7,deliveryId:'original-delivery'}));
});
it('keeps verified file links bound to actual paths and hashes',()=>{
 const w=workspace();w.deliveries=[{id:'done',status:'completed',verified:true,artifacts:[{artifactType:'final_render',relativePath:'episodes/episode/delivery/final.mp4',sha256:'actual-sha'}]}] as ProductionWorkspace['deliveries'];render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);const link=screen.getByRole('link',{name:'下载最终视频'});expect(link.getAttribute('href')).toContain('path=episodes%2Fepisode%2Fdelivery%2Ffinal.mp4&sha256=actual-sha');expect(screen.queryByRole('button',{name:'生成并验证交付包'})).toBeNull();
});

it('releases cover preview URLs when replaced and on unmount, while leaving the real file selection intact',()=>{
 const w=workspace(),view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);const first=new File(['first'],'first.png',{type:'image/png'}),second=new File(['second'],'second.png',{type:'image/png'});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[first]}});expect(createObjectURL).toHaveBeenLastCalledWith(first);fireEvent.change(screen.getByLabelText('封面'),{target:{files:[second]}});expect(revokeObjectURL).toHaveBeenCalledOnce();expect(createObjectURL).toHaveBeenLastCalledWith(second);expect(screen.getByText('second.png')).toBeTruthy();view.unmount();expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('releases the preview while delivery runs and restores it with the existing draft after a failed attempt',()=>{
 const w=workspace(),view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>),cover=new File(['cover'],'draft.png',{type:'image/png'});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[cover]}});const running={...w,deliveries:[{id:'d',status:'ready'}]} as ProductionWorkspace;view.rerender(<WorkspaceDeliveryPanel workspace={running} pending={false} command={vi.fn()} onChange={()=>{}}/>);expect(revokeObjectURL).toHaveBeenCalledOnce();const failed={...w,deliveries:[{id:'d',status:'failed',error:'重试'}]} as ProductionWorkspace;view.rerender(<WorkspaceDeliveryPanel workspace={failed} pending={false} command={vi.fn()} onChange={()=>{}}/>);expect(createObjectURL).toHaveBeenCalledTimes(2);expect(screen.getByRole('img',{name:'交付封面预览'})).toBeTruthy();expect(screen.getByText('draft.png')).toBeTruthy();
});

it('continues delivery polling when parent refreshes replace the callback',async()=>{
 vi.useFakeTimers();const w={...workspace(),deliveries:[{id:'d',status:'ready'}]} as ProductionWorkspace,finished={...w,deliveries:[{id:'d',exportId:'export',taskId:'task',status:'completed',verified:true,artifacts:[],error:null,createdAt:'2026-10-30T00:00:00Z'}]} as ProductionWorkspace;
 vi.mocked(localRequest).mockResolvedValue({workspace:finished});const view=render(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={vi.fn()}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(1000));view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={vi.fn()}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(1000));const latest=vi.fn();view.rerender(<WorkspaceDeliveryPanel workspace={w} pending={false} command={vi.fn()} onChange={latest}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(500));expect(latest).toHaveBeenCalledWith(finished);expect(localRequest).toHaveBeenCalledWith('episodes/episode/workspace');
});

 it('renders publishable metadata and hides raw technical files while providing real downloads',async()=>{
 const w=workspace();w.deliveries=[{id:'d',status:'completed',verified:true,artifacts:['cover','metadata','editable_project','final_qc_report'].map(artifactType=>({artifactType,relativePath:`${artifactType}.json`,sha256:'frozen',fileSize:10}))}] as ProductionWorkspace['deliveries'];
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({title:'发布标题',description:'发布简介',tags:['清晨','产品']})));const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 render(<WorkspaceDeliveryPanel workspace={w} pending={true} command={vi.fn()} onChange={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'发布标题'})).toBeTruthy();expect(screen.getByText('发布简介')).toBeTruthy();expect(screen.getByText('#清晨 #产品')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'复制简介'}));await waitFor(()=>expect(writeText).toHaveBeenCalledWith('发布简介'));
 expect(screen.getByRole('link',{name:'下载可编辑工程'}).getAttribute('href')).toContain('download=1');expect(screen.getByRole('link',{name:'下载全部交付文件（ZIP）'})).toBeTruthy();expect(document.querySelector('.workspace-delivery-technical')).toBeNull();expect(screen.queryByText('下载检查证据')).toBeNull();expect(screen.getByRole('button',{name:'复制标题'}).textContent).toBe('');expect(screen.getByRole('img',{name:'交付封面'})).toBeTruthy();vi.unstubAllGlobals();
});

it('restores non-secret delivery text after reopening but requires the cover file again',()=>{
 const w=workspace(),command=vi.fn(),renderPanel=()=>render(<WorkspaceDraftProvider ownerId="delivery-owner"><WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/></WorkspaceDraftProvider>);
 const view=renderPanel();fireEvent.change(screen.getByLabelText('标题'),{target:{value:'未提交标题'}});fireEvent.change(screen.getByLabelText('简介'),{target:{value:'未提交简介'}});fireEvent.change(screen.getByLabelText('标签'),{target:{value:'清晨,自然'}});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[new File(['png'],'封面.png',{type:'image/png'})]}});view.unmount();renderPanel();
 expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('未提交标题');expect((screen.getByLabelText('简介') as HTMLTextAreaElement).value).toBe('未提交简介');expect((screen.getByLabelText('标签') as HTMLInputElement).value).toBe('清晨,自然');expect(screen.getByText('请重新选择封面：封面.png')).toBeTruthy();expect(screen.queryByRole('img',{name:'交付封面预览'})).toBeNull();expect((screen.getByRole('button',{name:'生成并验证交付包'}) as HTMLButtonElement).disabled).toBe(true);expect(command).not.toHaveBeenCalled();
});
it('keeps text entered during a delivery request and clears only the successfully submitted draft',async()=>{
 const w=workspace();let finish!:(w:ProductionWorkspace)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));
 const view=render(<WorkspaceDraftProvider ownerId="pending-owner"><WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/></WorkspaceDraftProvider>);
 fireEvent.change(screen.getByLabelText('标题'),{target:{value:'请求中的标题'}});const cover=new File(['cover'],'cover.png',{type:'image/png'});Object.defineProperty(cover,'arrayBuffer',{value:async()=>new Uint8Array([1]).buffer});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[cover]}});fireEvent.click(screen.getByRole('button',{name:'生成并验证交付包'}));await waitFor(()=>expect(command).toHaveBeenCalledOnce());fireEvent.change(screen.getByLabelText('标题'),{target:{value:'请求后继续填写'}});await act(async()=>finish(w));view.unmount();
 render(<WorkspaceDraftProvider ownerId="pending-owner"><WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/></WorkspaceDraftProvider>);expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('请求后继续填写');
});
it('does not carry a live cover file into another export even when its recovered filename matches',()=>{
 const first=workspace(),second={...workspace(),exports:[{...workspace().exports![0],id:'another-export'}]},command=vi.fn(),panel=(w:ProductionWorkspace)=><WorkspaceDraftProvider ownerId="export-owner"><WorkspaceDeliveryPanel workspace={w} pending={false} command={command} onChange={()=>{}}/></WorkspaceDraftProvider>;
 const saved=render(panel(second));fireEvent.change(screen.getByLabelText('标题'),{target:{value:'另一导出草稿'}});fireEvent.change(screen.getByLabelText('封面'),{target:{files:[new File(['second'],'same-name.png',{type:'image/png'})]}});saved.unmount();const current=render(panel(first));fireEvent.change(screen.getByLabelText('封面'),{target:{files:[new File(['first'],'same-name.png',{type:'image/png'})]}});expect(screen.getByRole('img',{name:'交付封面预览'})).toBeTruthy();current.rerender(panel(second));expect(screen.queryByRole('img',{name:'交付封面预览'})).toBeNull();expect(screen.getByText('请重新选择封面：same-name.png')).toBeTruthy();
});
