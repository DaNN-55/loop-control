import{expect,it,vi}from'vitest';
import{createEpisodeReader}from'./episodeReadService';
it('变化分区合并且保留未变化历史，重复刷新共用在途读取',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({hashes:{episode:'a',tasks:'b',artifacts:'c'},sections:{episode:{id:'e'},tasks:[{id:'t',status:'running'}],artifacts:[{id:'a'}]}}).mockResolvedValueOnce({hashes:{episode:'a',tasks:'d',artifacts:'c'},sections:{tasks:[{id:'t',status:'completed'}]}});
 const load=createEpisodeReader<{episode:{id:string};tasks:unknown[];artifacts:unknown[]}>(fetch);
 const first=await load('e');const [next,duplicate]=await Promise.all([load('e'),load('e')]);
 expect(next.artifacts).toBe(first.artifacts);expect(next.tasks).toEqual([{id:'t',status:'completed'}]);expect(duplicate).toBe(next);expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][1]).toEqual({episode:'a',tasks:'b',artifacts:'c'});
});
it('不同会话不复用旧授权在途响应，保存后强制刷新等待并重新读取',async()=>{
 let release!:(value:unknown)=>void;
 const fetch=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValueOnce({hashes:{},sections:{value:'B'}}).mockResolvedValueOnce({hashes:{},sections:{value:'saved'}});
 const load=createEpisodeReader<{value:string}>(fetch);
 const a=load('e','session-A');expect((await load('e','session-B')).value).toBe('B');
 const fresh=load('e','session-A',true);release({hashes:{},sections:{value:'old'}});await a;expect((await fresh).value).toBe('saved');
});
it('任务行增量合并保留其余历史并按服务器ID集合移除旧记录',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({hashes:{},sections:{},patches:{tasks:{ids:['a','b'],rows:[{id:'a',value:1},{id:'b',value:2}]}}}).mockResolvedValueOnce({hashes:{},sections:{},patches:{tasks:{ids:['b'],rows:[{id:'b',value:3}]}}});
 const load=createEpisodeReader<{tasks:unknown[]}>(fetch);await load('e');expect((await load('e')).tasks).toEqual([{id:'b',value:3}]);
});
