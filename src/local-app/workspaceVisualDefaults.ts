const imagePaths=['imageSelection','settings.size','settings.quality','settings.count','imageBrief.framing','imageBrief.crop','imageBrief.captionSpace'] as const;
const videoPaths=['videoSelection','videoSettings.resolution','videoSettings.audio','videoSettings.promptExtend','videoSettings.shotType','videoSettings.watermark','videoSettings.seed','videoResolution','firstFrameFit','videoModeId'] as const;
const paths=[...imagePaths,...videoPaths];
type DefaultPath=typeof paths[number];
export interface VisualDefaultOverrides {version:1;fields:DefaultPath[]}
type ObjectValue=Record<string,unknown>;
const object=(value:unknown):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
function get(value:unknown,path:string):unknown{return path.split('.').reduce<unknown>((v,key)=>object(v)?v[key]:undefined,value);}
function has(value:unknown,path:string):boolean{const parts=path.split('.'),key=parts.pop()!;return object(parts.length?get(value,parts.join('.')):value)&&Object.hasOwn((parts.length?get(value,parts.join('.')):value) as ObjectValue,key);}
function put(value:ObjectValue,path:string,next:unknown){const [key,child]=path.split('.');if(child)value[key]={...(object(value[key])?value[key]:{}),[child]:next};else value[key]=next;}
function same(a:unknown,b:unknown):boolean{if(Object.is(a,b))return true;if(!object(a)||!object(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));}
function fields(value:unknown):DefaultPath[]|null{if(!object(value)||value.version!==1||!Array.isArray(value.fields))return null;const selected=value.fields;return paths.filter(path=>selected.includes(path));}

/** Only generation parameters can become shared defaults. Timing and source/text stay with a shot. */
export function visualDefaultsFor(draft:object,kind:'image'|'video'){
 const result:ObjectValue={};for(const path of kind==='image'?imagePaths:videoPaths)if(has(draft,path))put(result,path,get(draft,path));return result;
}
/** Remember changed fields only, so an older per-shot override cannot overwrite a newer shared choice. */
export function updatedVisualDefaults(previous:object,next:object,current:unknown,kind:'image'|'video'){
 const changed=(kind==='image'?imagePaths:videoPaths).filter(path=>!same(get(previous,path),get(next,path)));
 if(!changed.length)return null;
 const result=visualDefaultsFor(object(current)&&Object.keys(current).length?current:previous,kind);
 for(const path of changed)put(result,path,get(next,path));
 return result;
}
/** Old full snapshots lack edit provenance: infer unchanged values, retain differing values conservatively. */
export function restoreVisualDraft<T extends object>(base:T,saved:unknown,imageDefaults:unknown,videoDefaults:unknown):T&{defaultOverrides:VisualDefaultOverrides}{
 const prior=object(saved)?saved:{},next:ObjectValue={...base,...prior};
 for(const key of ['settings','imageBrief','videoSettings']){const initial=(base as ObjectValue)[key],stored=prior[key];next[key]={...(object(initial)?initial:{}),...(object(stored)?stored:{})};}
 const overrides=fields(prior.defaultOverrides)??paths.filter(path=>has(prior,path)&&!same(get(prior,path),get(base,path)));
 for(const path of paths){
  if(overrides.includes(path)){put(next,path,get(prior,path));continue;}
  const source=imagePaths.includes(path as typeof imagePaths[number])?imageDefaults:videoDefaults;
  put(next,path,has(source,path)?get(source,path):get(base,path));
 }
 next.defaultOverrides={version:1,fields:overrides};return next as T&{defaultOverrides:VisualDefaultOverrides};
}
/** Changes are tracked per parameter; editing a prompt or one setting cannot freeze other defaults. */
export function recordVisualDefaultEdits<T extends object>(previous:T,next:T):T&{defaultOverrides:VisualDefaultOverrides}{
 const prior=fields((previous as ObjectValue).defaultOverrides)??[];
 return {...next,defaultOverrides:{version:1,fields:paths.filter(path=>prior.includes(path)||!same(get(previous,path),get(next,path)))}};
}
