import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {EpisodeMetricsCells} from './EpisodeMetricsCells';
import type {EpisodeMetrics} from '../episodes/episodeCatalogTypes';
const metrics:EpisodeMetrics={cost:{actualCents:25,estimatedCents:40,reservedCents:1000,unpricedCount:1,recalculated:false},stageStartedAt:{script:'2026-11-02T00:00:00Z',preparation:'2026-11-02T01:00:00Z',delivery:'2026-11-02T02:00:00Z'},finishedAt:'2026-11-02T02:10:00Z',generations:{image:2,video:3,narration:1,sound:0,failed:1}};
it('shows only the selected stage, stops completed timers and separates actual and estimated expense',()=>{
 const {rerender}=render(<EpisodeMetricsCells metrics={metrics} step="delivery"/>);
 expect(screen.getByText('交付 · 10 分 0 秒')).toBeTruthy();expect(screen.queryByText(/脚本 ·/)).toBeNull();expect(screen.queryByText(/素材 ·/)).toBeNull();
 expect(screen.getByText('实际 ¥0.25')).toBeTruthy();expect(screen.getByText('估算 ≈¥0.40')).toBeTruthy();expect(screen.getByText('1 次费用待确认')).toBeTruthy();expect(screen.queryByText(/10.00/)).toBeNull();
 rerender(<EpisodeMetricsCells metrics={{...metrics,stageStartedAt:{}}} step="editing"/>);expect(screen.getByText('剪辑 · 未记录')).toBeTruthy();
});
it('counts from entry to the active stage without including previous stages',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T01:12:00Z'));
 try{render(<EpisodeMetricsCells metrics={{...metrics,finishedAt:null}} step="preparation"/>);expect(screen.getByText('素材 · 12 分 0 秒')).toBeTruthy();}finally{vi.useRealTimers();}
});
