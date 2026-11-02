import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import type {ComponentProps} from 'react';
import {EpisodeWorkspace} from './WorkspaceViews';
type Props=ComponentProps<typeof EpisodeWorkspace>;
const series={id:'series',name:'已有系列'} as Props['series'][number];
const props:Props={accounts:[],accountsById:new Map(),artifacts:[],blueprintsById:new Map(),episodeVisibility:'active',episodes:[],filter:'全部账号',onEpisodeVisibilityChange:vi.fn(),onFilter:vi.fn(),onSeriesFilter:vi.fn(),onSelectEpisode:vi.fn(),series:[series,{...series,id:'empty',name:'空系列'}],seriesById:new Map([[series.id,series]]),seriesFilter:'全部系列',seriesVersionsById:new Map(),selectedEpisode:null};
it('uses full catalog counts for collection options even when the current page has no matching records',()=>{
 const {rerender}=render(<EpisodeWorkspace {...props} seriesEpisodeCounts={{series:2,unassigned:1}}/>);
 expect(screen.getByRole('option',{name:'全部收纳'})).toBeTruthy();expect(screen.getByRole('option',{name:'已有系列'})).toBeTruthy();expect(screen.getByRole('option',{name:'未分系列'})).toBeTruthy();expect(screen.queryByRole('option',{name:'旧系列不可用'})).toBeNull();expect(screen.queryByRole('option',{name:'空系列'})).toBeNull();
 rerender(<EpisodeWorkspace {...props} seriesEpisodeCounts={{unavailable:1}}/>);
 expect(screen.getByRole('option',{name:'旧系列不可用'})).toBeTruthy();expect(screen.queryByRole('option',{name:'未分系列'})).toBeNull();expect(screen.queryByRole('option',{name:'已有系列'})).toBeNull();
 rerender(<EpisodeWorkspace {...props} seriesEpisodeCounts={{}}/>);expect(screen.getByRole('option',{name:'全部收纳'})).toBeTruthy();expect(screen.queryByRole('option',{name:'旧系列不可用'})).toBeNull();
});
it('uses physical collection before frozen series when the full local list supplies the counts',()=>{
 const episode={id:'episode',account_id:'account',series_version_id:'version',stage:'waiting_input',title:'待制作',created_at:'2026-11-02T00:00:00Z',updated_at:'2026-11-02T00:00:00Z'} as Props['episodes'][number];
 const version={id:'version',series_id:'series'} as Props['seriesVersionsById'] extends Map<string,infer Value>?Value:never;
 const {rerender}=render(<EpisodeWorkspace {...props} episodes={[episode,{...episode,id:'archived',series_version_id:'missing',archived_at:'2026-11-02T01:00:00Z'}]} seriesVersionsById={new Map([['version',version]])} collections={{episode:{containerId:'container',seriesId:null}}}/>);
 expect(screen.getByRole('option',{name:'未分系列'})).toBeTruthy();expect(screen.queryByRole('option',{name:'已有系列'})).toBeNull();expect(screen.queryByRole('option',{name:'旧系列不可用'})).toBeNull();
 rerender(<EpisodeWorkspace {...props} episodes={[episode]} seriesVersionsById={new Map([['version',version]])}/>);expect(screen.getByRole('option',{name:'已有系列'})).toBeTruthy();expect(screen.queryByRole('option',{name:'未分系列'})).toBeNull();
});
