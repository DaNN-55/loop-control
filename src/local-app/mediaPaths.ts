import{resolve,relative,isAbsolute}from'node:path';
// Trusted deployment aliases resolve logical, frozen roots at the I/O boundary.
export function mappedAssetPath(mediaRoot:string,value:unknown,sourceRoots:readonly string[]=[]):string{
 if(typeof value==='string'&&value!=='/'&&value.endsWith('/'))value=value.replace(/\/+$/,'');
 if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||!isAbsolute(mediaRoot)||resolve(mediaRoot)!==mediaRoot)throw Error('素材目录映射无效。');
 const within=(parent:string,child:string)=>{const p=relative(parent,child);return p!==''&&!p.startsWith('..')&&!isAbsolute(p);};
 if(within(mediaRoot,value))return value;
 const source=[...sourceRoots].filter(r=>typeof r==='string'&&isAbsolute(r)&&resolve(r)===r&&within(r,value)).sort((a,b)=>b.length-a.length)[0];
 if(!source)throw Error('素材目录超出本机授权映射。');
 const target=resolve(mediaRoot,relative(source,value));if(!within(mediaRoot,target))throw Error('素材目录映射越界。');return target;
}
