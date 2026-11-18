import {expect,it} from 'vitest';
import {compileScriptStudioDirection,directionSettingFields} from './scriptStudioDirection';
import {parseProductionScript,segmentSettings} from './reviews/productionScript';
import {scriptStudioText} from './scriptStudio';
import {workspaceScriptExample} from './local-app/workspaceScriptInput';
import {localScriptStudioPlan,studioShotCaptionsEnabled,studioShotNarrationEnabled} from './scriptStudio';
const shot={title:'画面',timingWeight:1,narrationEnabled:false,captionsEnabled:false,narration:'',subtitle:null,visual:'窗边的灯。',videoPrompt:'固定镜头。',camera:'固定',visualSource:'unassigned',settings:[]};
const draft={title:'窗边',summary:'用景别表达等待。',sourceUse:'画面描述',settings:[],shots:[shot],changes:[],warnings:[]};
it('derives summaries from mixed explicit switches and preserves those switches in executable input',()=>{
 const source='一人坐下。',plan=compileScriptStudioDirection({...draft,shots:[{...shot,narrationEnabled:true,captionsEnabled:true,narration:source},{...shot,captionsEnabled:true,subtitle:'坐下。'}]},source,{targetDuration:15,mode:'optimize'});
 expect(plan).toMatchObject({durationSeconds:15,narrationEnabled:true,captionsEnabled:true});
 const parsed=parseProductionScript(scriptStudioText(plan))!;
 expect(segmentSettings(parsed,parsed.segments[0])).toMatchObject({narrationEnabled:true,captionsEnabled:true});expect(segmentSettings(parsed,parsed.segments[1])).toMatchObject({narrationEnabled:false,captionsEnabled:true});
});
it.each([.1,.11,14.99,54,3600])('allocates exactly %s seconds in integer centiseconds',targetDuration=>{
 const count=targetDuration<.2?1:7,plan=compileScriptStudioDirection({...draft,shots:Array.from({length:count},(_,index)=>({...shot,timingWeight:index*13+1}))},'窗边的灯。',{targetDuration,mode:'optimize'});
 expect(plan.durationSeconds).toBe(targetDuration);expect(plan.shots.reduce((sum,s)=>sum+Math.round(s.durationSeconds*100),0)).toBe(Math.round(targetDuration*100));expect(plan.shots.every(s=>s.durationSeconds>=.1)).toBe(true);
});
it('reserves speech time before sharing the remaining rhythm and rejects impossible fixed totals',()=>{
 const source='口播：'+ '字'.repeat(70),value={...draft,shots:[{...shot,narrationEnabled:true,narration:'字'.repeat(70),timingWeight:1},{...shot,timingWeight:1000}]};
 const plan=compileScriptStudioDirection(value,source,{targetDuration:15,mode:'optimize'});expect(plan.shots[0].durationSeconds).toBeGreaterThanOrEqual(10);expect(plan.durationSeconds).toBe(15);
 expect(()=>compileScriptStudioDirection(value,source,{targetDuration:9,mode:'optimize'})).toThrow(/无法容纳/);
});
it('rejects duplicate switch settings, empty enabled speech and changed content instead of hiding contradictions',()=>{
 expect(()=>compileScriptStudioDirection({...draft,settings:[{field:'口播启用',value:'默认'}]},'窗边的灯。',{targetDuration:15,mode:'optimize'})).toThrow(/制作设置/);
 expect(()=>compileScriptStudioDirection({...draft,shots:[{...shot,narrationEnabled:true}]},'窗边的灯。',{targetDuration:15,mode:'optimize'})).toThrow(/每个启用口播/);
 expect(()=>compileScriptStudioDirection({...draft,shots:[{...shot,narrationEnabled:true,narration:'改写正文'}]},'口播：原文不改。',{targetDuration:15,mode:'optimize'})).toThrow(/口播/);
});
it('retains explicitly timed source shots and their effective switches instead of reallocating them by weights',()=>{
 const local=localScriptStudioPlan(workspaceScriptExample,null),{durationSeconds:_,narrationEnabled:__,captionsEnabled:___,canProceed:____,shots,...metadata}=local;
 const value={...metadata,settings:local.settings.filter(s=>directionSettingFields.global.includes(s.field)),shots:shots.map(({durationSeconds:_,...s})=>({...s,timingWeight:1,narrationEnabled:studioShotNarrationEnabled(local,s as typeof shots[number]),captionsEnabled:studioShotCaptionsEnabled(local,s as typeof shots[number]),settings:s.settings.filter(v=>directionSettingFields.shot.includes(v.field))}))};
 const plan=compileScriptStudioDirection(value,workspaceScriptExample,{targetDuration:null,mode:'optimize'});expect(plan.shots.map(s=>s.durationSeconds)).toEqual(local.shots.map(s=>s.durationSeconds));
 expect(()=>compileScriptStudioDirection({...value,shots:value.shots.map(s=>({...s,captionsEnabled:false}))},workspaceScriptExample,{targetDuration:null,mode:'optimize'})).toThrow(/字幕/);
 expect(()=>compileScriptStudioDirection({...value,shots:value.shots.map((s,index)=>index===1?{...s,narrationEnabled:false}:s)},workspaceScriptExample,{targetDuration:null,mode:'optimize'})).toThrow(/口播/);
});
it('retains a partially explicit source time while compiling the unspecified remainder',()=>{
 const source='# 部分时长\n## 制作设置\n- 模板版本：3\n## 正文\n### 段落 01\n- 口播：一。\n- 画面来源：暂未选择\n- 镜头时长（秒）：10\n### 段落 02\n- 口播：二。\n- 画面来源：暂未选择';
 const plan=compileScriptStudioDirection({...draft,title:'部分时长',shots:['一。','二。'].map(narration=>({...shot,narration,narrationEnabled:true,captionsEnabled:true}))},source,{targetDuration:null,mode:'optimize'});
 expect(plan.shots.map(s=>s.durationSeconds)).toEqual([10,3]);
});

it('allows an explicit narration request to read an unchanged excerpt from otherwise visual prose',()=>{
 const source='她把早餐端到窗边，看着树叶上的雨水，说：“慢一点，也能把早晨过好。”其他文字按画面表达。';
 const value={...draft,shots:[shot,{...shot,narrationEnabled:true,narration:'慢一点，也能把早晨过好。'}]};
 const plan=compileScriptStudioDirection(value,source,{targetDuration:30,mode:'optimize',instruction:'只有引号里的那一句作为人物口播并逐字保留，其余文字按画面安排。'});
 expect(plan.durationSeconds).toBe(30);expect(plan.shots.map(s=>s.narration)).toEqual(['','慢一点，也能把早晨过好。']);expect(plan.changes).toEqual([]);
});
it.each([
 ['','慢一点，也能把早晨过好。'],
 ['只把台词作为口播','快一点，也能把早晨过好。'],
 ['只把台词作为口播','把早晨过好，慢一点。'],
])('rejects unrequested or rewritten narration excerpts (%s)',(instruction,narration)=>{
 const source='她看着雨水，说：“慢一点，也能把早晨过好。”';
 expect(()=>compileScriptStudioDirection({...draft,shots:[{...shot,narrationEnabled:true,narration}]},source,{targetDuration:30,mode:'optimize',instruction})).toThrow(/口播/);
});
it('does not use an excerpt request to omit existing explicit narration or subtitle text',()=>{
 for(const source of ['口播：慢一点，也能把早晨过好。','字幕：慢一点，也能把早晨过好。']){
  expect(()=>compileScriptStudioDirection({...draft,shots:[{...shot,narrationEnabled:true,narration:'慢一点，'}]},source,{targetDuration:30,mode:'optimize',instruction:'只口播前面一句'})).toThrow(/口播/);
 }
});
