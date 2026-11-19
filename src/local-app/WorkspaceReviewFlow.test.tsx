import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ProductionWorkspace} from '../productionWorkspace';
import {WorkspaceExportPanel} from './WorkspaceExportPanel';
vi.mock('./WorkspacePublicationPanel',()=>({WorkspacePublicationPanel:()=> <section aria-label="发布资料（可选）"/>}));
afterEach(cleanup);
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
