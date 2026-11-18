import {validateScriptStudioPlan,studioShotNarrationEnabled,studioShotCaptionsEnabled,type ScriptStudioPlan,type ScriptStudioShot} from './scriptStudio.js';
export type ScriptStudioShotText=Pick<ScriptStudioShot,'title'|'visual'|'videoPrompt'|'camera'|'narration'|'subtitle'>;
const fields=['title','visual','videoPrompt','camera','narration','subtitle'];
/** Text edits derive a new approved-by-Owner candidate; source and execution controls stay fixed. */
export function editScriptStudioShot(base:ScriptStudioPlan,source:string,targetDuration:number|null,index:unknown,patch:unknown):ScriptStudioPlan{
 if(!Number.isInteger(index)||typeof index!=='number'||index<0||index>=base.shots.length||!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('镜头或修改内容无效。');
 const entries=Object.entries(patch);
 if(!entries.length||entries.some(([key,value])=>!fields.includes(key)||!(typeof value==='string'||key==='subtitle'&&value===null)))throw Error('只能修改当前镜头的文字，不能更改时长或制作设置。');
 const plan=structuredClone(base),shot=plan.shots[index];
 if(entries.every(([key,value])=>shot[key as keyof ScriptStudioShot]===value))throw Error('镜头文字没有变化。');
 Object.assign(shot,patch);
 const note='包含手动修订，原文保留；镜头时长与制作设置未变。';
 if(!plan.changes.includes(note))plan.changes.push(note);
 const validated=validateScriptStudioPlan(plan,source,{targetDuration,mode:'revision'});
 if(!base.changes.length&&!entries.some(([key])=>['narration','subtitle'].includes(key)&&shot[key as keyof ScriptStudioShot]!==base.shots[index][key as keyof ScriptStudioShot]))validated.changes=[];
 return validated;
}

/** Explicit Owner deletion derives a candidate; remaining shots keep words/switches and gain time. */
export function deleteScriptStudioShot(base:ScriptStudioPlan,source:string,targetDuration:number|null,index:unknown):ScriptStudioPlan{
 if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=base.shots.length)throw Error('镜头无效。');
 if(base.shots.length<=1)throw Error('至少保留一个镜头。');
 const plan=structuredClone(base),removed=plan.shots.splice(index,1)[0],total=Math.round(plan.durationSeconds*100),weights=plan.shots.map(shot=>Math.round(shot.durationSeconds*100)),weight=weights.reduce((sum,n)=>sum+n,0);
 const shares=weights.map(n=>Math.floor(total*n/weight)),order=weights.map((n,i)=>({index:i,remainder:total*n%weight})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
 for(let i=0,left=total-shares.reduce((sum,n)=>sum+n,0);i<left;i++)shares[order[i].index]++;
 plan.shots.forEach((shot,i)=>{shot.durationSeconds=shares[i]/100;});
 plan.narrationEnabled=plan.shots.some(shot=>studioShotNarrationEnabled(base,shot));plan.captionsEnabled=plan.shots.some(shot=>studioShotCaptionsEnabled(base,shot));
 const note='包含手动删除，原文保留；其余镜头按比例分配总时长。';if(!plan.changes.includes(note))plan.changes.push(note);
 plan.summary='已手动删除「'+removed.title+'」；总时长保持，其余镜头按比例分配时长。';
 return validateScriptStudioPlan(plan,source,{targetDuration,mode:'revision'});
}
