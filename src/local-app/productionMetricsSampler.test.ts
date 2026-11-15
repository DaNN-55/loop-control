// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {productionMetricsSampleIntervalMs,startOwnerProductionMetricsSampler,startProductionMetricsSampler,type ProductionMetricsActivity,type ProductionMetricsResourceSample} from './productionMetricsSampler.js';

afterEach(()=>vi.useRealTimers());
function fixture(){
 vi.useFakeTimers();let at=Date.parse('2026-11-13T00:00:00Z'),ticks={idle:100,total:200};
 let activity:ProductionMetricsActivity={enabled:true,queued:1,running:1,resourceWait:1};
 const samples:ProductionMetricsResourceSample[]=[],port={activity:vi.fn(async()=>activity),record:vi.fn(async(s:ProductionMetricsResourceSample)=>{samples.push(s);return true;}),prune:vi.fn(async()=>({}))};
 const cpu=vi.fn(()=>({...ticks}));
 return{port,samples,cpu,options:{enabled:true,port,now:()=>at,cpu,memory:()=>({totalBytes:1024,freeBytes:256})},
  advance:(ms=productionMetricsSampleIntervalMs)=>{at+=ms;},ticks:(value:typeof ticks)=>{ticks=value;},activity:(value:ProductionMetricsActivity)=>{activity=value;}};
}
it('samples active work at 30 seconds with independent CPU deltas, bounded memory and unknown GPU',async()=>{
 const f=fixture(),sampler=startProductionMetricsSampler(f.options);try{
  await sampler.wake();expect(f.samples).toHaveLength(1);expect(f.samples[0]).toMatchObject({cpu_percent:null,memory_used_bytes:768,memory_total_bytes:1024,queue_count:1,running_count:1,resource_wait_count:1,gpu_percent:null,gap_seconds:0});
  f.advance(29_999);await sampler.wake();expect(f.samples).toHaveLength(1);
  f.advance(1);f.ticks({idle:125,total:300});await sampler.wake();expect(f.samples[1].cpu_percent).toBe(75);expect(f.samples[1].gap_seconds).toBe(0);
  expect(f.port.prune).toHaveBeenCalledTimes(1);
 }finally{await sampler.stop();}
});
it('does not access any database or install a timer by default',async()=>{
 vi.useFakeTimers();const pool={connect:vi.fn(),query:vi.fn()} as unknown as Pool;
 const sampler=startOwnerProductionMetricsSampler({pool,ownerId:'unused'});await sampler.wake();await vi.advanceTimersByTimeAsync(120_000);await sampler.stop();
 expect(pool.connect).not.toHaveBeenCalled();expect(pool.query).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 expect(()=>startOwnerProductionMetricsSampler({pool,ownerId:'',enabled:true})).toThrow('explicit Owner');
});
it('does not sample when the Owner control is off and stops CPU accounting across idle intervals',async()=>{
 const f=fixture();f.activity({enabled:false,queued:1,running:1,resourceWait:1});const sampler=startProductionMetricsSampler(f.options);try{
  await sampler.wake();expect(f.samples).toHaveLength(0);expect(f.cpu).not.toHaveBeenCalled();expect(f.port.prune).not.toHaveBeenCalled();
  f.activity({enabled:true,queued:0,running:0,resourceWait:0});f.advance();await sampler.wake();expect(f.samples).toHaveLength(0);expect(f.cpu).not.toHaveBeenCalled();
  f.activity({enabled:true,queued:1,running:0,resourceWait:0});f.advance();await sampler.wake();expect(f.samples[0].cpu_percent).toBeNull();
  f.activity({enabled:true,queued:0,running:0,resourceWait:0});f.advance();await sampler.wake();
  f.activity({enabled:true,queued:1,running:0,resourceWait:0});f.advance(120_000);f.ticks({idle:500,total:900});await sampler.wake();
  expect(f.samples).toHaveLength(2);expect(f.samples[1]).toMatchObject({cpu_percent:null,gap_seconds:0});
 }finally{await sampler.stop();}
});
it('records a gap after sampling failures and never rejects a Worker-facing wake',async()=>{
 const f=fixture(),sampler=startProductionMetricsSampler(f.options);try{
  await sampler.wake();f.port.record.mockRejectedValueOnce(Error('secret /path'));
  f.advance();await expect(sampler.wake()).resolves.toBeUndefined();expect(sampler.status().lastError).toBe('resource_observation_failed');
  f.advance();f.ticks({idle:300,total:600});await sampler.wake();expect(f.samples.at(-1)).toMatchObject({cpu_percent:null,gap_seconds:30});expect(sampler.status().lastError).toBeNull();
  expect(JSON.stringify(sampler.status())).not.toContain('secret');
 }finally{await sampler.stop();}
});
it('shows an event-loop observation gap, and does not invent CPU usage after counter resets',async()=>{
 const f=fixture(),sampler=startProductionMetricsSampler(f.options);try{
  await sampler.wake();f.advance(90_000);f.ticks({idle:50,total:100});await sampler.wake();expect(f.samples[1]).toMatchObject({cpu_percent:null,gap_seconds:60});
  f.advance();f.ticks({idle:300,total:200});await sampler.wake();expect(f.samples[2].cpu_percent).toBe(0);
 }finally{await sampler.stop();}
});
it('carries a failed active observation across idle without counting intentional idle as a gap',async()=>{
 const f=fixture();f.port.record.mockRejectedValueOnce(Error('interrupted'));const sampler=startProductionMetricsSampler(f.options);try{
  await sampler.wake();f.advance();f.activity({enabled:true,queued:0,running:0,resourceWait:0});await sampler.wake();
  f.advance(120_000);await sampler.wake();expect(f.samples).toHaveLength(0);
  f.advance();f.activity({enabled:true,queued:1,running:0,resourceWait:0});await sampler.wake();expect(f.samples[0]).toMatchObject({cpu_percent:null,gap_seconds:30});
 }finally{await sampler.stop();}
});
it('does not overlap requests, waits for a running observation on stop, and writes nothing after stop',async()=>{
 const f=fixture();let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
 f.port.activity.mockImplementationOnce(async()=>{await blocked;return{enabled:true,queued:1,running:0,resourceWait:0};});
 const sampler=startProductionMetricsSampler(f.options),first=sampler.wake(),second=sampler.wake();expect(first).toBe(second);expect(f.port.activity).toHaveBeenCalledTimes(1);
 let stopped=false;const stop=sampler.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);release();await stop;
 expect(f.samples).toHaveLength(0);await sampler.wake();await vi.advanceTimersByTimeAsync(90_000);expect(f.port.activity).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('runs retention once a day even while idle and contains retention errors',async()=>{
 const f=fixture();f.activity({enabled:true,queued:0,running:0,resourceWait:0});f.port.prune.mockRejectedValueOnce(Error('private'));
 const sampler=startProductionMetricsSampler(f.options);try{
  await sampler.wake();expect(sampler.status().lastError).toBe('retention_failed');f.advance();await sampler.wake();expect(f.port.prune).toHaveBeenCalledTimes(2);expect(sampler.status().lastError).toBeNull();
  f.advance(86_400_000);await sampler.wake();expect(f.port.prune).toHaveBeenCalledTimes(3);expect(f.samples).toHaveLength(0);
 }finally{await sampler.stop();}
});
it('samples local exports independently from Worker counts and preserves both gates and idle intervals',async()=>{
 const f=fixture();f.activity({enabled:true,queued:0,running:0,resourceWait:0,localExports:2});const sampler=startProductionMetricsSampler(f.options);
 try{
  await sampler.wake();expect(f.samples).toHaveLength(1);expect(f.samples[0]).toMatchObject({queue_count:0,running_count:0,resource_wait_count:0,local_export_count:2,cpu_percent:null});
  f.activity({enabled:false,queued:0,running:0,resourceWait:0,localExports:2});f.advance();await sampler.wake();expect(f.samples).toHaveLength(1);
  f.activity({enabled:true,queued:0,running:0,resourceWait:0,localExports:0});f.advance();await sampler.wake();expect(f.samples).toHaveLength(1);
  f.activity({enabled:true,queued:0,running:0,resourceWait:0,localExports:1});f.advance();await sampler.wake();expect(f.samples[1]).toMatchObject({local_export_count:1,cpu_percent:null,gap_seconds:0});
 }finally{await sampler.stop();}
});
