export async function readAllPages<T>(page:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown;count?:number|null}>,identify:(row:T)=>string=row=>String((row as {id:string}).id)):Promise<{data:T[];error:null}> {
  const rows:T[]=[],seen=new Set<string>();let total:number|undefined;
  for(let offset=0;;){
    const result=await page(offset,offset+499);if(result.error)throw result.error;
    const values=result.data??[];
    if(total===undefined&&typeof result.count==="number")total=result.count;
    for(const row of values){const id=identify(row);if(!seen.has(id)){seen.add(id);rows.push(row);}}
    if(total!==undefined&&typeof result.count==="number"&&result.count!==total)throw Error("列表在分页期间变化，请刷新重试。");
    offset+=values.length;
    if(total!==undefined?offset>=total:values.length<500){if(total!==undefined&&rows.length!==total)throw Error("列表在分页期间变化，请刷新重试。");return{data:rows,error:null};}
    if(!values.length)throw Error("列表在分页期间变化，请刷新重试。");
  }
}
