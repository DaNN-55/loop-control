import {act,render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceExportPanel} from './WorkspaceExportPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(cleanup);
it('Owner sees the actual final MP4 and confirms its exact file and content identities',async()=>{
 const workspace={id:'w',episodeId:'e',revision:3,contentSha256:'content',stale:false,readiness:{deliverable:false,placeholders:[],missingSources:[]},exports:[{id:'ex',status:'ready',current:true,confirmed:false,artifact:{relativePath:'episodes/e/final.mp4',sha256:'final-sha',fileSize:1234},checks:[{name:'technical',passed:true,detail:'技术检查通过'}]}]} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>workspace);render(<WorkspaceExportPanel workspace={workspace} pending={false} command={command} onChange={()=>{}}/>);
 expect(screen.getByLabelText('最终导出视频').getAttribute('src')).toContain('final.mp4');fireEvent.click(screen.getByRole('button',{name:'确认成片与字幕'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('confirmWorkspaceExport',{episodeId:'e',workspaceId:'w',expectedRevision:3,exportId:'ex',expectedExportSha256:'final-sha',expectedContentSha256:'content'}));
});

it('puts checks first and file information below the preview without exposing raw paths or hashes',()=>{
 const w={id:'w',episodeId:'e',revision:1,stale:false,readiness:{placeholders:[]},exports:[{id:'ex',current:true,confirmed:true,status:'ready',projectContentVersion:8,artifact:{relativePath:'opaque-file.mp4',sha256:'raw-fingerprint',fileSize:6148396},checks:[{name:'decode',passed:true,detail:'可播放'}]}],deliveries:[{id:'d',status:'completed',verified:true,artifacts:[]}]} as unknown as ProductionWorkspace;
 render(<WorkspaceExportPanel workspace={w} readOnly pending={false} command={vi.fn()} onChange={()=>{}}/>);
 const review=document.querySelector('.workspace-export-review')!;expect(review.firstElementChild?.getAttribute('aria-label')).toBe('技术检查');expect(review.textContent).not.toContain('文件信息');expect(document.querySelector('.workspace-final-preview .workspace-final-details summary')?.textContent).toBe('文件信息');expect(screen.queryByText('raw-fingerprint')).toBeNull();expect(screen.queryByText('opaque-file.mp4')).toBeNull();expect(screen.getByRole('button',{name:'重新导出视频'}).textContent).toBe('重新导出视频');expect(screen.getByRole('button',{name:'重新导出视频'}).hasAttribute('disabled')).toBe(true);
});
it('opens failed checks so their explanation stays visible',()=>{
 const w={id:'w',episodeId:'e',revision:1,stale:false,readiness:{placeholders:[]},exports:[{id:'ex',current:true,confirmed:false,status:'failed',checks:[{name:'decode',passed:false,detail:'视频无法解码'}]}]} as unknown as ProductionWorkspace;
 render(<WorkspaceExportPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);expect(document.querySelector('.workspace-technical-checks')?.hasAttribute('open')).toBe(true);expect(screen.getByRole('alert').textContent).toContain('视频无法解码');
});

it('keeps the next issue during a slow submission and preserves input after errors',async()=>{
 const w={id:'w',episodeId:'e',revision:1,readiness:{placeholders:[]},exports:[]} as unknown as ProductionWorkspace;
 let finish!:(value:ProductionWorkspace)=>void,reject!:(error:Error)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>((resolve,fail)=>{finish=resolve;reject=fail;}));render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 const input=screen.getByRole('textbox',{name:'问题记录'});fireEvent.change(input,{target:{value:'第一条问题'}});fireEvent.click(screen.getByRole('button',{name:'记录问题'}));fireEvent.click(screen.getByRole('button',{name:/记录问题/}));expect(command).toHaveBeenCalledTimes(1);fireEvent.change(input,{target:{value:'第二条问题'}});await act(async()=>finish(w));expect((input as HTMLTextAreaElement).value).toBe('第二条问题');
 fireEvent.click(screen.getByRole('button',{name:'记录问题'}));await act(async()=>reject(Error('记录失败，请重试。')));expect((input as HTMLTextAreaElement).value).toBe('第二条问题');expect(screen.getByRole('alert').textContent).toContain('记录失败');
 fireEvent.click(screen.getByRole('button',{name:'记录问题'}));await act(async()=>finish(w));expect((input as HTMLTextAreaElement).value).toBe('');
});
