import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ComponentProps} from 'react';
import type {PublicationCover} from '../workspacePublication';
import type {ProductionWorkspace} from '../productionWorkspace';
import {WorkspaceExportPanel} from './WorkspaceExportPanel';
let cover:PublicationCover|null=null;
type PublicationProps=ComponentProps<typeof import('./WorkspacePublicationPanel').WorkspacePublicationPanel>;
vi.mock('./WorkspacePublicationPanel',()=>({WorkspacePublicationPanel:({children}:PublicationProps)=> <section aria-label="发布资料（可选）">
 {children?.({state:cover?{cover}:null} as Parameters<NonNullable<PublicationProps['children']>>[0],false)}
</section>}));
afterEach(()=>{cleanup();vi.restoreAllMocks();cover=null;});
const w={id:'w',episodeId:'e',revision:3,contentSha256:'content',stale:false,readiness:{placeholders:[]},exports:[{id:'export',current:true,status:'ready',confirmed:false,artifact:{relativePath:'final.mp4',sha256:'video',fileSize:10},checks:[{name:'decode',passed:true,detail:'可播放'}]}],deliveries:[]} as unknown as ProductionWorkspace;
it('shows one final confirmation and hands the exact displayed file to automatic completion',async()=>{
 const command=vi.fn(async()=>w),edit=vi.fn();render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}} onEdit={edit}/>);
 expect(screen.getByLabelText('最终导出视频').getAttribute('src')).toContain('sha256=video');
 fireEvent.click(screen.getByRole('button',{name:'确认并完成'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('completeWorkspaceExport',{episodeId:'e',workspaceId:'w',expectedRevision:3,exportId:'export',expectedExportSha256:'video',expectedContentSha256:'content'}));
 fireEvent.click(screen.getByRole('button',{name:'返回剪辑'}));expect(edit).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'生成并验证交付包'})).toBeNull();
});
it('does not start rendering from merely viewing a page and prevents repeated generation clicks',async()=>{
 let done!:(value:ProductionWorkspace)=>void;const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{done=resolve;}));
 render(<WorkspaceExportPanel workspace={{...w,exports:[]}} pending={false} command={command} onChange={()=>{}}/>);expect(command).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'生成成片'}));fireEvent.click(screen.getByRole('button',{name:'正在生成成片…'}));expect(command).toHaveBeenCalledTimes(1);await act(async()=>done(w));
});

it('hides the current download when its file fails and keeps old versions behind history',()=>{
 const current={...w.exports![0],confirmed:true};
 const previous={...current,id:'older',projectContentVersion:2,current:false,artifact:{relativePath:'old.mp4',sha256:'older',fileSize:10}};
 const workspace={...w,exports:[current,previous],deliveries:[{
  id:'delivery',exportId:current.id,status:'completed',verified:true,
  artifacts:[{artifactType:'final_render',...current.artifact}],
 }]} as ProductionWorkspace;
 render(<WorkspaceExportPanel workspace={workspace} pending={false} readOnly completedView command={vi.fn()} onChange={()=>{}}/>);
 const download=screen.getByRole('link',{name:'下载视频'});
 expect(download.getAttribute('href')).toContain('path=final.mp4');
 expect(download.closest('header')).toBeTruthy();
 fireEvent.error(screen.getByLabelText('最终导出视频'));
 expect(screen.queryByRole('link',{name:'下载视频'})).toBeNull();
 expect(screen.getByText('当前成片文件无法读取。')).toBeTruthy();
 const history=screen.getByLabelText('检查与导出记录');
 expect(history.closest('.workspace-export-review')).toBeTruthy();
 expect(history.hasAttribute('open')).toBe(false);
 fireEvent.click(screen.getByText('检查与导出记录'));
 expect(screen.getByRole('link',{name:'下载工程版本 v2'}).getAttribute('href')).toContain('path=old.mp4');
});


it('opens a completed delivery on its cover, plays within the same preview, and falls back if the cover is missing',()=>{
 cover={file:{relativePath:'cover.png',sha256:'cover',fileSize:10},name:'封面',source:{kind:'upload'}};
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 const pause=vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 render(<WorkspaceExportPanel workspace={w} pending={false} readOnly completedView onEdit={vi.fn()} command={vi.fn()} onChange={()=>{}}/>);
 expect(screen.getByRole('img',{name:'交付封面'})).toBeTruthy();
 const video=screen.getByLabelText('最终导出视频');
 expect(video.closest('[hidden]')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'返回剪辑'})).toBeNull();
 expect(play).not.toHaveBeenCalled();

 fireEvent.click(screen.getByRole('button',{name:'播放成片'}));
 expect(play).toHaveBeenCalledOnce();
 expect(video.closest('[hidden]')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'封面'}));
 expect(pause).toHaveBeenCalled();
 fireEvent.error(screen.getByRole('img',{name:'交付封面'}));
 expect(video.closest('[hidden]')).toBeNull();
 expect(screen.queryByRole('img',{name:'交付封面'})).toBeNull();
});
