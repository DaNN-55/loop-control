// @vitest-environment node
import{it,expect,vi}from'vitest';
vi.mock('node:child_process',()=>({execFile:vi.fn((...args:unknown[])=>{const done=args.at(-1) as (e:null,v:string)=>void;done(null,'local tool');})}));
import{assertMediaReady,nativeMediaTask}from'./mediaWorker';
it('blocks a frozen external media task before tool or secret resolution in local-only deployment',async()=>{
 await expect(assertMediaReady({mode:'local'},{}, {},true)).rejects.toThrow('在线媒体执行尚未配置');
});
it('blocks unified video execution in local-only deployment before resolving secrets',async()=>{
 await expect(assertMediaReady({mode:'local'},{video:{execution_path:'external'}})).rejects.toThrow('在线媒体执行尚未配置');
});
it('allows local media tool readiness without enabling online execution',async()=>{
 await expect(assertMediaReady({mode:'local'})).resolves.toBeUndefined();
});

it.each(['generate_a_roll','generate_b_roll'])('accepts %s through the native Wan media Worker',type=>{expect(nativeMediaTask(type,'bailian')).toBe(true);});
