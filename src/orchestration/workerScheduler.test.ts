// @vitest-environment node
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { startWorkerScheduler } from "./workerScheduler";

const roots:string[]=[];
afterEach(async() => {vi.unstubAllGlobals();await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function isolatedEvidence(){const directory=await mkdtemp(join(tmpdir(),"loop-scheduler-evidence-"));roots.push(directory);return{LOOP_N8N_STATE_DIR:directory};}

it("规划RPC尚未返回时，即时唤醒仍可领取空槽", async () => {
  let releasePlan!: () => void, planStarted=false;
  const holdPlan=new Promise<void>(resolve=>{releasePlan=resolve;});
  const queue:string[]=[],started:string[]=[];
  vi.stubGlobal("fetch",async(url:URL)=>{
    const name=String(url);
    if(name.includes("orchestrate_provided_script_tasks")){planStarted=true;await holdPlan;}
    const result=name.includes("/episodes?")?[{id:"episode"}]:name.includes("claim_next_worker_task")&&queue.length?[{task_id:queue.shift(),attempt:0,lease_token:"token"}]:[];
    return{ok:true,json:async()=>result};
  });
  const scheduler=await startWorkerScheduler({projectRoot:"/controlled",environment:await isolatedEvidence(),supabaseUrl:"http://127.0.0.1:1",serviceRoleKey:"test",concurrency:1},{prepare:async()=>undefined,execute:async task=>{started.push(task.task_id);return{status:"completed"};}});
  try{
    await vi.waitFor(()=>expect(planStarted).toBe(true));
    queue.push("new");scheduler.wake({taskId:"new"});
    await vi.waitFor(()=>expect(started).toEqual(["new"]));
  }finally{releasePlan();await scheduler.stop();}
});

it("长任务执行时继续短扫描，重复唤醒合并且关闭后不再扫描", async () => {
  const queue = ["long"];
  const started: string[] = [];
  const releases: Array<() => void> = [];
  let claimsInFlight=0, peakClaims=0;
  vi.stubGlobal("fetch", async (url: URL) => {
    const claim=String(url).includes("claim_next_worker_task");
    if(claim){claimsInFlight++;peakClaims=Math.max(peakClaims,claimsInFlight); }
    await new Promise(resolve=>setTimeout(resolve,2));
    let result: unknown[]=[];
    if(String(url).includes("claim_next_worker_task") && queue.length)result=[{task_id:queue.shift(),attempt:0,lease_token:"token"}];
    else if(String(url).includes("/tasks?") && queue.length)result=[{id:queue[0]}];
    if(claim)claimsInFlight--;return {ok:true,json:async()=>result};
  });
  const scheduler=await startWorkerScheduler({projectRoot:"/controlled",environment:await isolatedEvidence(),supabaseUrl:"http://127.0.0.1:1",serviceRoleKey:"test",concurrency:2}, {
    prepare:async()=>undefined,
    execute:async task=>{started.push(task.task_id);await new Promise<void>(resolve=>releases.push(resolve));return {status:"completed"};},
  });
  try {
    await vi.waitFor(()=>expect(started).toEqual(["long"]));
    queue.push("new");
    for(let i=0;i<20;i++)scheduler.wake({taskId:"new"});
    await vi.waitFor(()=>expect(started).toEqual(["long","new"]));
    expect(scheduler.status().activeWorkers).toBe(2);
    expect(peakClaims).toBe(1);
    expect(scheduler.status().scans).toBeLessThan(10);
  } finally { releases.forEach(release=>release());await scheduler.stop(); }
  const scans=scheduler.status().scans;scheduler.wake();await new Promise(resolve=>setTimeout(resolve,15));
  expect(scheduler.status().scans).toBe(scans);
  expect(scheduler.status().stopped).toBe(true);
});
