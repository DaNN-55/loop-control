import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceExportPanel} from './WorkspaceExportPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
vi.mock('./WorkspacePublicationPanel',()=>({WorkspacePublicationPanel:()=>null}));
afterEach(cleanup);
const base={id:'w',episodeId:'e',revision:4,stale:false,contentSha256:'current-content',readiness:{placeholders:[]},exports:[{id:'current',status:'ready',current:true,confirmed:true,contentSha256:'current-content',artifact:{relativePath:'current.mp4',sha256:'current-video',fileSize:12},checks:[]}],deliveries:[]} as unknown as ProductionWorkspace;
it('shows the latest failure instead of letting historical success hide its retry',async()=>{
 const w={...base,deliveries:[{id:'latest-failed',taskId:'task-failed',createdAt:'2026-11-19',exportId:'current',status:'failed',verified:false,error:'最近一次交付失败',artifacts:[]},{id:'historical-completed',taskId:'task-history',createdAt:'2026-11-18',error:null,exportId:'older-export',status:'completed',verified:true,artifacts:[{artifactType:'final_render',relativePath:'history/final.mp4',sha256:'history-sha',fileSize:12}]}]} as ProductionWorkspace;
 const command=vi.fn(async()=>w);render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);
 const details=screen.getByLabelText('查看详情');fireEvent.click(details.querySelector('summary')!);expect(screen.getByRole('link',{name:'下载历史视频'}).getAttribute('href')).toContain('sha256=history-sha');
 expect(screen.getByText('完成未成功')).toBeTruthy();expect(screen.getByText('最近一次交付失败')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'重试完成'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('retryWorkspaceDelivery',{episodeId:'e',workspaceId:'w',expectedRevision:4,deliveryId:'latest-failed'}));
});
it('retains actual historical download identities even when its export is outdated',()=>{
 const w={...base,exports:[{...base.exports![0],current:false,projectContentVersion:3}],deliveries:[{id:'verified-history',taskId:'task-history',createdAt:'2026-11-18',error:null,exportId:'current',status:'completed',verified:true,artifacts:[{artifactType:'final_render',relativePath:'history/final.mp4',sha256:'historical-sha',fileSize:12}]}]} as ProductionWorkspace;
 const command=vi.fn();render(<WorkspaceExportPanel workspace={w} pending={false} readOnly command={command} onChange={()=>{}}/>);
 expect(screen.getByText('视频需重新生成')).toBeTruthy();expect(screen.getByRole('link',{name:'下载已完成视频'}).getAttribute('href')).toContain('path=history%2Ffinal.mp4&sha256=historical-sha');expect(screen.queryByRole('button',{name:'确认并完成'})).toBeNull();expect(command).not.toHaveBeenCalled();
});
it('keeps technical details and export history secondary without exposing raw paths',()=>{
 const w={...base,exports:[{...base.exports![0],projectContentVersion:8,artifact:{relativePath:'opaque-file.mp4',sha256:'raw-fingerprint',fileSize:6148396}}]};
 render(<WorkspaceExportPanel workspace={w} readOnly pending={false} command={vi.fn()} onChange={()=>{}}/>);
 const details=screen.getByLabelText('查看详情');expect(details.hasAttribute('open')).toBe(false);expect(details.textContent).toContain('v8');expect(screen.queryByText('raw-fingerprint')).toBeNull();expect(screen.queryByText('opaque-file.mp4')).toBeNull();
});
it('shows failed checks immediately without asking the user to open details',()=>{
 const w={...base,exports:[{...base.exports![0],confirmed:false,status:'failed' as const,checks:[{name:'decode',passed:false,detail:'视频无法解码'}]}]};
 render(<WorkspaceExportPanel workspace={w} pending={false} command={vi.fn()} onChange={()=>{}}/>);expect(screen.getByRole('alert').textContent).toContain('视频无法解码');expect(screen.queryByRole('button',{name:'确认并完成'})).toBeNull();expect(screen.getByRole('button',{name:'重新生成成片'})).toBeTruthy();
});
it('has no issue entry or artificial problem-resolution gate',()=>{
 render(<WorkspaceExportPanel workspace={base} pending={false} command={vi.fn()} onChange={()=>{}}/>);expect(screen.queryByRole('textbox',{name:'问题记录'})).toBeNull();expect(screen.queryByText('问题与复核记录')).toBeNull();expect(screen.getByRole('button',{name:'确认并完成'})).toBeTruthy();
});
it('requires new output after actual video content changes',()=>{
 const w={...base,exports:[{...base.exports![0],current:false}]};const command=vi.fn();render(<WorkspaceExportPanel workspace={w} pending={false} command={command} onChange={()=>{}}/>);expect(screen.getByText('视频需重新生成')).toBeTruthy();expect(screen.getByRole('button',{name:'重新生成成片'})).toBeTruthy();expect(screen.queryByRole('button',{name:'确认并完成'})).toBeNull();expect(command).not.toHaveBeenCalled();
});
