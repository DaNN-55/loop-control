import {expect,it} from "vitest";
import {readAllPages} from "./pagedRead";
it("服务端上限小于请求页长时仍读取超过1000条，保留顺序且不重复",async()=>{
 const rows=Array.from({length:1005},(_,id)=>({id:String(id)}));let requests=0;
 const result=await readAllPages(async(from:number,to:number)=>{requests++;return {data:rows.slice(from,Math.min(to+1,from+100)),error:null,count:1005};});
 expect(result.data).toEqual(rows);expect(requests).toBe(11);
});
it("空列表不追加请求，失败不返回伪完整结果",async()=>{
 expect((await readAllPages(async()=>({data:[],error:null,count:0}))).data).toEqual([]);
 await expect(readAllPages(async()=>({data:null,error:Error('denied'),count:null}))).rejects.toThrow('denied');
});
it("分页期间排序移动导致重复和漏行时明确拒绝伪完整结果",async()=>{
 const all=Array.from({length:501},(_,id)=>({id:String(id)}));
 await expect(readAllPages(async(from)=>({data:from===0?all.slice(0,500):[all[499]],error:null,count:501}))).rejects.toThrow("分页期间变化");
});
