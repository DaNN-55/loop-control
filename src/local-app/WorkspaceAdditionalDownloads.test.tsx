import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceAdditionalDownloads} from './WorkspaceAdditionalDownloads';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceDelivery} from '../workspaceDelivery';
import type {useWorkspacePublication} from './useWorkspacePublication';
afterEach(cleanup);
it('keeps completed downloads usable while publication is still loading after refresh',()=>{
 const publication={state:null,dirty:false,saving:false,flush:vi.fn()} as unknown as ReturnType<typeof useWorkspacePublication>;
 render(<WorkspaceAdditionalDownloads workspace={{id:'w',episodeId:'e'} as ProductionWorkspace} delivery={{id:'d',artifacts:[]} as unknown as WorkspaceDelivery} publication={publication}/>);
 expect(screen.getByText('下载原交付包（ZIP）').getAttribute('href')).toContain('delivery=d');
 expect(screen.getByRole('button',{name:'下载交付文件（ZIP）',hidden:true})).toHaveProperty('disabled',true);
});

it('does not implicitly save an open publication editor when downloading',()=>{
 const publication={state:{revision:2},dirty:true,saving:false,flush:vi.fn()} as unknown as ReturnType<typeof useWorkspacePublication>;
 render(<WorkspaceAdditionalDownloads workspace={{id:'w',episodeId:'e'} as ProductionWorkspace} delivery={{id:'d',artifacts:[]} as unknown as WorkspaceDelivery} publication={publication} editing/>);
 expect(screen.getByRole('button',{name:'下载交付文件（ZIP）',hidden:true})).toHaveProperty('disabled',true);
 expect(screen.getByText('下载原交付包（ZIP）').getAttribute('href')).toContain('delivery=d');
 expect(publication.flush).not.toHaveBeenCalled();
});
