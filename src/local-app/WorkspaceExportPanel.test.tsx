import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceExportPanel} from './WorkspaceExportPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(cleanup);
it('Owner sees the actual final MP4 and confirms its exact file and content identities',async()=>{
 const workspace={id:'w',episodeId:'e',revision:3,contentSha256:'content',stale:false,readiness:{deliverable:false,placeholders:[],missingSources:[]},exports:[{id:'ex',status:'ready',current:true,confirmed:false,artifact:{relativePath:'episodes/e/final.mp4',sha256:'final-sha',fileSize:1234},checks:[{name:'technical',passed:true,detail:'技术检查通过'}]}]} as unknown as ProductionWorkspace;
 const command=vi.fn(async()=>workspace);render(<WorkspaceExportPanel workspace={workspace} pending={false} command={command} onChange={()=>{}}/>);
 expect(screen.getByLabelText('最终导出视频').getAttribute('src')).toContain('final.mp4');fireEvent.click(screen.getByRole('button',{name:'确认这份最终文件'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('confirmWorkspaceExport',{episodeId:'e',workspaceId:'w',expectedRevision:3,exportId:'ex',expectedExportSha256:'final-sha',expectedContentSha256:'content'}));
});
