// @vitest-environment node
import {expect,it} from 'vitest';
import {summarizeEpisodeMetrics} from './episodeMetrics';
type Task=Parameters<typeof summarizeEpisodeMetrics>[0][number];
const run={started_at:'2026-11-02T00:00:00Z',completed_at:'2026-11-02T00:01:00Z',status:'completed',actual_cost_cents:0};
const task:Task={id:'task',episode_id:'episode',task_type:'generate_b_roll',provider:'bailian',model:'wan2.6-i2v-flash',status:'completed',actual_cost_cents:0,claimed_at:null,completed_at:null,input_snapshot:{},last_result:null,runs:[run],request:null,estimate:null,reserved_cents:1000};
it('separates recorded actual cost, estimates, unknowns and reservations across all attempts',()=>{
 const metrics=summarizeEpisodeMetrics([
  {...task,id:'mixed',runs:[{...run,status:'failed',actual_cost_cents:25},run],estimate:{estimatedCents:40}},
  {...task,id:'unpriced'},
  {...task,id:'queued',status:'ready',runs:[]},
  {...task,id:'upload',provider:'manual_upload'},
 ]).episode;
 expect(metrics.cost).toEqual({actualCents:25,estimatedCents:40,unpricedCount:1,reservedCents:2000,recalculated:false});
 expect(metrics.generations).toEqual({image:0,video:3,narration:0,sound:0,failed:1});
});
it('uses frozen estimates first and labels historic recalculation, never treating zero reports as free',()=>{
 const metrics=summarizeEpisodeMetrics([{...task,request:{providerDurationSeconds:4,prompt:'雨夜',selection:{provider:'bailian',model:task.model},videoSettings:{resolution:'720P',audio:false}}}]).episode;
 expect(metrics.cost).toMatchObject({actualCents:null,estimatedCents:60,recalculated:true,unpricedCount:0});
 expect(summarizeEpisodeMetrics([{...task,estimate:{estimatedCents:30},request:{providerDurationSeconds:4}}]).episode.cost).toMatchObject({estimatedCents:30,recalculated:false});
 expect(summarizeEpisodeMetrics([task]).episode.cost).toMatchObject({actualCents:null,estimatedCents:null,unpricedCount:1});
});
it('keeps repeated reads stable and does not substitute reserved amounts for unknown cost',()=>{
 const first=summarizeEpisodeMetrics([task]);expect(summarizeEpisodeMetrics([task])).toEqual(first);
 expect(first.episode.cost.actualCents).toBeNull();expect(first.episode.cost.estimatedCents).toBeNull();
});
it('uses the frozen connection region for historic MiniMax estimates and keeps an unknown region unpriced',()=>{
 const minimax={...task,provider:'minimax',model:'MiniMax-H3',request:{providerDurationSeconds:4,selection:{provider:'minimax',model:'MiniMax-H3'}}};
 expect(summarizeEpisodeMetrics([{...minimax,request_region:'cn'}]).episode.cost.estimatedCents).toBe(200);
 expect(summarizeEpisodeMetrics([{...minimax,request_region:'international'}]).episode.cost.estimatedCents).toBe(231);
 expect(summarizeEpisodeMetrics([minimax]).episode.cost).toMatchObject({estimatedCents:null,unpricedCount:1});
});

it('counts only worker intervals and merges overlapping runs',()=>{
 const metrics=summarizeEpisodeMetrics([
  task,
  {...task,id:'queued',status:'ready',runs:[]},
  {...task,id:'upload',provider:'manual_upload',runs:[{...run,completed_at:'2026-11-02T02:00:00Z'}]},
  {...task,id:'render',task_type:'generate_review_render',status:'running',runs:[
   {...run,started_at:'2026-11-02T00:00:30Z',completed_at:'2026-11-02T00:02:00Z',status:'failed'},
   {...run,started_at:'2026-11-02T00:03:00Z',completed_at:null,status:'running'},
  ]},
 ],Date.parse('2026-11-02T00:04:00Z')).episode;
 expect(metrics.workerRunSeconds).toBe(180);
});

it('keeps canonical and legacy video operations equivalent in cost and work statistics',()=>{
 const legacy=summarizeEpisodeMetrics([task]);
 for(const task_type of ['generate_shot_video','search_shot_video','preview_shot_video'])expect(summarizeEpisodeMetrics([{...task,task_type}])).toEqual(legacy);
});
