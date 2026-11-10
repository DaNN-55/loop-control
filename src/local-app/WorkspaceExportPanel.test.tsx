import {act,render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceExportPanel} from './WorkspaceExportPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('keeps historical completion in the overview while the latest failed delivery retains its original retry',async()=>{
 const w={id:'w',episodeId:'e',revision:4,stale:false,contentSha256:'current-content',readiness:{placeholders:[]},exports:[{id:'current',status:'ready',current:true,confirmed:true,contentSha256:'current-content',artifact:{relativePath:'current.mp4',sha256:'current-video',fileSize:12},checks:[]}],deliveries:[{id:'latest-failed',exportId:'current',status:'failed',verified:false,error:'最近一次交付失败',artifacts:[]},{id:'historical-completed',exportId:'older-export',status:'completed',verified:true,artifacts:[]}]} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>w);render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 expect(screen.getByText('交付已完成')).toBeTruthy();expect(screen.getByText('交付失败')).toBeTruthy();expect(screen.queryByRole('button',{name:'重新导出视频'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'重试原交付'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('retryWorkspaceDelivery',{episodeId:'e',workspaceId:'w',expectedRevision:4,deliveryId:'latest-failed'}));
});
it('retains verified historical delivery downloads when the latest export is outdated',()=>{
 const w={id:'w',episodeId:'e',revision:4,stale:false,readiness:{placeholders:[]},exports:[{id:'old-export',status:'ready',current:false,confirmed:true,artifact:{relativePath:'old.mp4',sha256:'old-video',fileSize:12},checks:[]}],deliveries:[{id:'verified-history',exportId:'old-export',status:'completed',verified:true,artifacts:[{artifactType:'final_render',relativePath:'history/final.mp4',sha256:'historical-sha',fileSize:12}]}]} as unknown as ProductionWorkspace;
 const command=vi.fn();render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 expect(screen.getByText('交付已完成')).toBeTruthy();expect(screen.getByText('这是旧导出，请先重新导出。')).toBeTruthy();expect(screen.getByRole('button',{name:'确认成片与字幕'})).toHaveProperty('disabled',true);
 expect(screen.getByRole('link',{name:'下载最终视频'}).getAttribute('href')).toContain('path=history%2Ffinal.mp4&sha256=historical-sha');expect(screen.queryByRole('button',{name:'重新导出视频'})).toBeNull();expect(command).not.toHaveBeenCalled();
});
it('Owner sees the actual final MP4 and confirms its exact file and content identities',async()=>{
 const workspace={id:'w',episodeId:'e',revision:3,contentSha256:'content',stale:false,readiness:{deliverable:false,placeholders:[],missingSources:[]},exports:[{id:'ex',status:'ready',current:true,confirmed:false,artifact:{relativePath:'episodes/e/final.mp4',sha256:'final-sha',fileSize:1234},checks:[{name:'technical',passed:true,detail:'技术检查通过'}]}]} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>workspace);render(<WorkspaceExportPanel workspace={workspace} pending={false} command={command} onChange={()=>{}}/>);
 expect(screen.getByLabelText('最终导出视频').getAttribute('src')).toContain('final.mp4');fireEvent.click(screen.getByRole('button',{name:'确认成片与字幕'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('confirmWorkspaceExport',{episodeId:'e',workspaceId:'w',expectedRevision:3,exportId:'ex',expectedExportSha256:'final-sha',expectedContentSha256:'content'}));
});

it('groups issues below checks and secondary file details with export history',()=>{
 const w={id:'w',episodeId:'e',revision:1,stale:false,readiness:{placeholders:[]},exports:[{id:'ex',current:true,confirmed:true,status:'ready',projectContentVersion:8,artifact:{relativePath:'opaque-file.mp4',sha256:'raw-fingerprint',fileSize:6148396},checks:[{name:'decode',passed:true,detail:'可播放'}]}],exportIssues:[{id:'issue',reason:'已处理的问题',resolved:true}],deliveries:[{id:'d',status:'completed',verified:true,artifacts:[]}]} as unknown as ProductionWorkspace;
 render(<WorkspaceExportPanel workspace={w} readOnly pending={false} command={vi.fn()} onChange={()=>{}}/>);
 const review=document.querySelector('.workspace-export-review')!;expect(review.firstElementChild?.getAttribute('aria-label')).toBe('技术检查');expect(review.children[1]?.getAttribute('aria-label')).toBe('导出问题');expect(review.children[2]?.getAttribute('aria-label')).toBe('交付包');expect(document.querySelector('.workspace-final-preview .workspace-final-details')).toBeNull();expect(review.querySelector('.workspace-export-secondary summary')?.textContent).toBe('文件信息与导出历史');expect(review.querySelector('.workspace-export-secondary')?.textContent).toContain('v8');expect(screen.queryByText('raw-fingerprint')).toBeNull();expect(screen.queryByText('opaque-file.mp4')).toBeNull();expect(screen.queryByRole('button',{name:'重新导出视频'})).toBeNull();
});
it('opens failed checks so their explanation stays visible',()=>{
 const w={id:'w',episodeId:'e',revision:1,stale:false,readiness:{placeholders:[]},exports:[{id:'ex',current:true,confirmed:false,status:'failed',checks:[{name:'decode',passed:false,detail:'视频无法解码'}]}]} as unknown as ProductionWorkspace;
 render(<WorkspaceExportPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);expect(document.querySelector('.workspace-technical-checks')?.hasAttribute('open')).toBe(true);expect(screen.getByRole('alert').textContent).toContain('视频无法解码');
});

it('keeps the next issue during a slow submission and preserves input after errors',async()=>{
 const w={id:'w',episodeId:'e',revision:1,readiness:{placeholders:[]},exports:[]} as unknown as ProductionWorkspace;
 let finish!:(value:ProductionWorkspace)=>void,reject!:(error:Error)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>((resolve,fail)=>{finish=resolve;reject=fail;}));render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 fireEvent.click(screen.getByText('问题记录',{selector:'summary h4'}));const input=screen.getByRole('textbox',{name:'问题记录'});fireEvent.change(input,{target:{value:'第一条问题'}});fireEvent.click(screen.getByRole('button',{name:'记录问题'}));fireEvent.click(screen.getByRole('button',{name:/记录问题/}));expect(command).toHaveBeenCalledTimes(1);fireEvent.change(input,{target:{value:'第二条问题'}});await act(async()=>finish(w));expect((input as HTMLTextAreaElement).value).toBe('第二条问题');
 fireEvent.click(screen.getByRole('button',{name:'记录问题'}));await act(async()=>reject(Error('记录失败，请重试。')));expect((input as HTMLTextAreaElement).value).toBe('第二条问题');expect(screen.getByRole('alert').textContent).toContain('记录失败');
 fireEvent.click(screen.getByRole('button',{name:'记录问题'}));await act(async()=>finish(w));expect((input as HTMLTextAreaElement).value).toBe('');
});

it('requires a new export after content changes even when an old confirmation remains in history',()=>{
 const w={id:'w',episodeId:'e',revision:4,contentSha256:'new',stale:false,readiness:{placeholders:[]},exports:[{id:'old',current:false,confirmed:true,status:'ready',artifact:{relativePath:'old.mp4',sha256:'old',fileSize:12},checks:[{passed:true,detail:'历史检查通过'}]}]}as unknown as ProductionWorkspace;const command=vi.fn();render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);expect(screen.getByText('需重新导出')).toBeTruthy();expect(screen.queryByText('已确认这份最终文件')).toBeNull();expect((screen.getByRole('button',{name:'确认成片与字幕'})as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('textbox',{name:'标题'})).toBeNull();expect(command).not.toHaveBeenCalled();
});
it('prevents repeated export submission and names only the active export as running',async()=>{
 const w={id:'w',episodeId:'e',revision:1,stale:false,readiness:{placeholders:[]},exports:[]}as unknown as ProductionWorkspace;let finish!:(w:ProductionWorkspace)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'导出视频'}));expect(screen.getByRole('button',{name:'正在导出与检查…'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'正在导出与检查…'}));expect(command).toHaveBeenCalledOnce();await act(async()=>finish(w));expect(screen.getByRole('button',{name:'导出视频'})).toBeTruthy();
});
