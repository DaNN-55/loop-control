import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
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

it('groups one completed ZIP with the existing record and editor actions',()=>{
 const publication={state:{revision:2},dirty:false,saving:false,flush:vi.fn()} as unknown as ReturnType<typeof useWorkspacePublication>;
 const delivery={id:'d',artifacts:[{artifactType:'editable_project',relativePath:'project.json',sha256:'project'}]} as unknown as WorkspaceDelivery;
 const completedActions={viewScript:vi.fn(),viewStoryboard:vi.fn(),openProject:vi.fn()};
 render(<WorkspaceAdditionalDownloads workspace={{id:'w',episodeId:'e'} as ProductionWorkspace} delivery={delivery} publication={publication} completedActions={completedActions}/>);
 const more=screen.getByText('更多操作');
 fireEvent.click(more);
 const downloads=within(screen.getByRole('group',{name:'下载'}));
 expect(downloads.getByRole('button',{name:'下载交付包（ZIP）'})).toBeTruthy();
 expect(downloads.queryByRole('link')).toBeNull();
 const actions=within(screen.getByRole('group',{name:'查看与编辑'}));
 expect(actions.getAllByRole('button')).toHaveLength(3);
 fireEvent.click(actions.getByRole('button',{name:'打开剪辑工程'}));
 expect(completedActions.openProject).toHaveBeenCalledOnce();
 expect(more.closest('details')?.open).toBe(false);
 expect(publication.flush).not.toHaveBeenCalled();
});
