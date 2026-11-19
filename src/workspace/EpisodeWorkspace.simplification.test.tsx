import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {ComponentProps} from 'react';
import {EpisodeWorkspace} from './WorkspaceViews';

afterEach(()=>{cleanup();localStorage.clear();});
const episode={id:'one',account_id:'account',title:'山间日出',stage:'waiting_input',created_at:'2026-11-19T00:00:00Z',updated_at:'2026-11-19T00:00:00Z'} as ComponentProps<typeof EpisodeWorkspace>['episodes'][number];
function setup(){
 const open=vi.fn(),preview=vi.fn();
 const props:ComponentProps<typeof EpisodeWorkspace>={accounts:[],accountsById:new Map(),artifacts:[],blueprintsById:new Map(),episodeVisibility:'active',episodes:[episode],filter:'全部账号',onEpisodeVisibilityChange:vi.fn(),onFilter:vi.fn(),onSeriesFilter:vi.fn(),onSelectEpisode:open,onPreviewEpisode:preview,series:[],seriesById:new Map(),seriesFilter:'全部系列',seriesVersionsById:new Map(),selectedEpisode:null};
 const view=render(<EpisodeWorkspace {...props}/>);return{...view,open,preview};
}
it('previews row selection while the title opens the production directly',()=>{
 const {container,open,preview}=setup();
 fireEvent.click(container.querySelector('.episode-row')!);
 expect(preview).toHaveBeenCalledWith('one');expect(open).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'山间日出'}));
 expect(open).toHaveBeenCalledWith('one');expect(preview).toHaveBeenCalledTimes(1);
});
it('starts with a compact list and only exposes statistics and more filters on request',()=>{
 const {unmount}=setup();
 expect(screen.queryByRole('columnheader',{name:/后台任务用时/})).toBeNull();
 expect(screen.queryByRole('combobox',{name:'归档范围'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'显示统计'}));
 expect(screen.getByRole('columnheader',{name:'后台任务用时'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'筛选'}));
 expect(screen.getByRole('combobox',{name:'归档范围'})).toBeTruthy();
 unmount();setup();expect(screen.getByRole('columnheader',{name:'后台任务用时'})).toBeTruthy();
});
