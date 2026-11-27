import {parseProductionScript} from './reviews/productionScript.js';
import {localScriptStudioPlan,validateScriptStudioPlan} from './scriptStudio.js';

const schema='loop-control-handoff/v1';
const leaf=/^[a-z0-9][a-z0-9._-]{0,95}\.(?:png|jpe?g)$/i;
const scalar=/^(schema|handoff_id|product_id|title): ("(?:[^"\\]|\\.)*")$/;
const image=/^ {2}- "images\/([a-z0-9._-]+)"$/i;

/** Read the canonical file handoff, leaving ordinary Markdown and text uploads alone.
 * The emitter writes a small, deterministic YAML subset; no tags, aliases or paths are evaluated.
 */
export function storyboardHandoffText(value:string):string{
 const text=value.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
 if(!text.startsWith('---\n'))return value;
 const end=text.indexOf('\n---\n',4),header=text.slice(4,end<0?undefined:end);
 if(!/^\s*schema\s*:\s*["']?loop-control-handoff\//m.test(header))return value;
 if(end<0)throw Error('交接文件缺少结束的 YAML 分隔线。');
 const fields=new Map<string,string>(),files=new Set<string>(),caseFolded=new Set<string>();
 let readingImages=false;
 for(const line of header.split('\n')){
  if(!line.trim())continue;
  const file=readingImages&&image.exec(line);
  if(file){const name=file[1],key=name.toLowerCase();if(!leaf.test(name)||name.length>100||caseFolded.has(key))throw Error('交接图片名称无效或重复：'+name);files.add(name);caseFolded.add(key);continue;}
  readingImages=false;
  const match=scalar.exec(line),revision=/^revision: ([1-9]\d{0,3})$/.exec(line);
  const key=match?.[1]??(revision?'revision':line==='product_images:'?'product_images':null);
  if(!key||fields.has(key))throw Error('交接文件头字段无效或重复，请从策稿重新导出。');
  let decoded:string;
  try{decoded=match?JSON.parse(match[2]):revision?.[1]??'';}catch{throw Error('交接文件头字段无法读取，请从策稿重新导出。');}
  fields.set(key,decoded);readingImages=key==='product_images';
 }
 const handoffId=fields.get('handoff_id')??'';
 if(fields.get('schema')!==schema||handoffId.length>80||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handoffId)||!fields.has('revision')||!fields.get('product_id')?.trim()||!fields.get('title')?.trim()||!files.size)throw Error('交接编号、版本、标题、商品或参考图清单无效，请从策稿重新导出。');
 const rest=text.slice(end+5).trimStart();
 if(!/^## 脚本[ \t]*\n/.test(rest))throw Error('交接文件缺少「## 脚本」章节。');
 const body=rest.slice(rest.indexOf('\n')+1).split(/^## 商品事实[ \t]*(?:\n|$)/m,1)[0].trim();
 const script=parseProductionScript(body);
 if(script?.version!==3)throw Error('交接脚本必须使用 Loop Control 分镜模板版本 3。');
 for(const shot of script.segments){
  if(shot.settings.duration===undefined)throw Error(`段落 ${shot.paragraph} 必须明确填写镜头时长。`);
  const name=shot.settings.materialReference;
  if((shot.visualSource==='material'||name)&&(!name||!files.has(name)))throw Error(`段落 ${shot.paragraph} 的素材名称不在交接图片清单中：${name??'未填'}`);
 }
 const plan=validateScriptStudioPlan(localScriptStudioPlan(body,null),body,{targetDuration:null,mode:'optimize'});
 if(!plan.canProceed||plan.sourceUse!=='结构化脚本'||plan.shots.length!==script.segments.length||plan.shots.some((shot,i)=>shot.durationSeconds!==script.segments[i].settings.duration))throw Error('交接文件无法按原镜头和时长识别，请从策稿重新导出。');
 return body;
}
