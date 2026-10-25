// @vitest-environment node
import{it,expect,vi}from'vitest';
vi.mock('node:child_process',()=>({execFile:vi.fn((...args:unknown[])=>{const done=args.at(-1) as (e:null,v:string)=>void;done(null,'local tool');})}));
import{assertMediaReady}from'./mediaWorker';
it('blocks a frozen external media task before tool or secret resolution in local-only deployment',async()=>{
 await expect(assertMediaReady({mode:'local'},{}, {},true)).rejects.toThrow('在线媒体执行尚未配置');
});
it('allows local media tool readiness without enabling online execution',async()=>{
 await expect(assertMediaReady({mode:'local'})).resolves.toBeUndefined();
});
