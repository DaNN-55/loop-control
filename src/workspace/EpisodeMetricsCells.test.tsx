import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {EpisodeMetricsCells} from './EpisodeMetricsCells';
import type {EpisodeMetrics} from '../episodes/episodeCatalogTypes';
const metrics:EpisodeMetrics={cost:{actualCents:25,estimatedCents:40,reservedCents:1000,unpricedCount:1,recalculated:false},workerRunSeconds:600,generations:{image:2,video:3,narration:1,sound:0,failed:1}};
it('shows worker duration and separates actual and estimated expense',()=>{
 const {rerender}=render(<EpisodeMetricsCells metrics={metrics}/>);
 expect(screen.getByText('10 分 0 秒')).toBeTruthy();expect(screen.queryByText(/脚本 ·/)).toBeNull();expect(screen.queryByText(/素材 ·/)).toBeNull();
 expect(screen.getByText('实际 ¥0.25')).toBeTruthy();expect(screen.getByText('估算 ≈¥0.40')).toBeTruthy();expect(screen.getByText('1 次费用待确认')).toBeTruthy();expect(screen.queryByText(/10.00/)).toBeNull();
 rerender(<EpisodeMetricsCells metrics={{...metrics,workerRunSeconds:null}}/>);expect(screen.getByText('未记录')).toBeTruthy();
});
