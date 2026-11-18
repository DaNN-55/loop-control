import {describe,it,expect} from 'vitest';
import {localScriptStudioPlan,scriptStudioText,validateScriptStudioPlan} from './scriptStudio';
import {parseProductionScript,segmentSettings} from './reviews/productionScript';
import {workspaceScriptExample} from './local-app/workspaceScriptInput';
describe('script studio production contract',()=>{
 it('preserves a partially specified shot duration and allocates only the remaining total',()=>{
  const source='# 部分时长\n## 制作设置\n- 模板版本：3\n## 正文\n### 段落 01\n- 口播：一。\n- 画面来源：暂未选择\n- 镜头时长（秒）：10\n### 段落 02\n- 口播：二。\n- 画面来源：暂未选择';
  const plan=localScriptStudioPlan(source,null);expect(plan.durationSeconds).toBe(13);expect(plan.shots.map(s=>s.durationSeconds)).toEqual([10,3]);
  expect(localScriptStudioPlan(source,15).shots.map(s=>s.durationSeconds)).toEqual([10,5]);
  expect(()=>localScriptStudioPlan(source,10)).toThrow(/明确镜头时长/);
 });
 it('inherits default voice and caption settings instead of treating them as off',()=>{
  const source='口播：慢一点回家。',plan=localScriptStudioPlan(source,15);
  plan.settings=[{field:'口播启用',value:'开启'},{field:'字幕',value:'开启'}];
  plan.shots[0].settings=[{field:'口播启用',value:'默认'},{field:'字幕',value:'默认'}];
  const parsed=parseProductionScript(scriptStudioText(validateScriptStudioPlan(plan,source,{targetDuration:15,mode:'optimize'})))!;
  expect(segmentSettings(parsed,parsed.segments[0])).toMatchObject({narrationEnabled:true,captionsEnabled:true});
 });
 it.each([['global','targetDuration'],['shot','mode'],['shot','画幅'],['global','镜头时长（秒）']] as const)('rejects %s setting %s before serialization even in an unproducible plan',(scope,field)=>{
  const source='一个人进门。',plan=localScriptStudioPlan(source,15);plan.canProceed=false;
  (scope==='global'?plan.settings:plan.shots[0].settings).push({field,value:'15'});
  expect(()=>validateScriptStudioPlan(plan,source,{targetDuration:15,mode:'optimize'})).toThrow('拍法包含不支持的'+(scope==='global'?'全局':'镜头')+'制作设置：'+field);
 });
 it('keeps arbitrary Markdown prose as one silent shot and retains its original text',()=>{
  const source='# 不完整标题\n\n一个人进门。\n\n他坐下等待。',plan=localScriptStudioPlan(source,15);
  expect(plan.shots).toHaveLength(1);expect(plan.narrationEnabled).toBe(false);expect(plan.captionsEnabled).toBe(false);expect(plan.shots[0].visual).toBe(source);expect(plan.durationSeconds).toBe(15);
  expect(parseProductionScript(scriptStudioText(plan))?.segments).toHaveLength(1);
 });
 it('rejects changed total duration and fabricated spoken content in the default creative mode',()=>{
  const source='一个人进门，坐下等待。',plan=localScriptStudioPlan(source,15);
  expect(()=>validateScriptStudioPlan({...plan,durationSeconds:16},source,{targetDuration:15,mode:'optimize'})).toThrow();
  expect(()=>validateScriptStudioPlan({...plan,narrationEnabled:true,shots:[{...plan.shots[0],narration:'另一个人离开。'}]},source,{targetDuration:15,mode:'optimize'})).toThrow();
 });
 it('allows creative visual direction while preserving exact spoken text and duration',()=>{
  const source='口播：雨停了，慢一点回家。',plan=localScriptStudioPlan(source,15);
  const value={...plan,shots:[{...plan.shots[0],visual:'低机位拍摄街灯倒影',camera:'缓慢推近',videoPrompt:'摄影机沿倒影推进。'}]};
  expect(validateScriptStudioPlan(value,source,{targetDuration:15,mode:'optimize'}).shots[0].camera).toBe('缓慢推近');
 });
 it('requires explicit adaptation and lists its content changes',()=>{
  const source='一个人进门。',plan=localScriptStudioPlan(source,15);
  expect(()=>validateScriptStudioPlan({...plan,changes:['新增朋友出现'],narrationEnabled:true,shots:[{...plan.shots[0],narration:'朋友已在窗边等他。'}]},source,{targetDuration:15,mode:'optimize'})).toThrow();
  expect(validateScriptStudioPlan({...plan,changes:['新增朋友出现'],narrationEnabled:true,shots:[{...plan.shots[0],narration:'朋友已在窗边等他。'}]},source,{targetDuration:15,mode:'adapt'}).changes).toHaveLength(1);
 });
 it('keeps explicit source timing even when the target field is empty',()=>{
  const plan=localScriptStudioPlan(workspaceScriptExample,null);expect(plan.durationSeconds).toBe(14);
  expect(()=>validateScriptStudioPlan({...plan,durationSeconds:15,shots:plan.shots.map((s,i)=>({...s,durationSeconds:s.durationSeconds+(i===0?1:0)}))},workspaceScriptExample,{targetDuration:null,mode:'optimize'})).toThrow(/总时长/);
 });
 it('preserves per-shot subtitles and explicit voice switches in executable settings',()=>{
  const source=workspaceScriptExample.replace('- 旁白音色：默认','- 口播启用：关闭\n- 旁白音色：默认'),plan=localScriptStudioPlan(source,null);
  expect(plan.narrationEnabled).toBe(false);const parsed=parseProductionScript(scriptStudioText(plan))!;
  expect(parsed.settings.narrationEnabled).toBe(false);expect(parsed.segments[2].settings.captionsEnabled).toBe(false);
  expect(()=>validateScriptStudioPlan({...plan,narrationEnabled:true},source,{targetDuration:null,mode:'optimize'})).toThrow();
 });
 it('restores omitted non-filming settings and rejects their reversal',()=>{
  const plan=localScriptStudioPlan(workspaceScriptExample,null),missing={...plan,settings:[],shots:plan.shots.map(s=>({...s,settings:s.settings.filter(x=>x.field!=='字幕')}))};
  const checked=validateScriptStudioPlan(missing,workspaceScriptExample,{targetDuration:null,mode:'optimize'});expect(checked.settings).toContainEqual({field:'画幅',value:'9:16'});expect(checked.shots[2].settings).toContainEqual({field:'字幕',value:'关闭'});
  expect(()=>validateScriptStudioPlan({...plan,settings:plan.settings.map(s=>s.field==='画幅'?{...s,value:'16:9'}:s)},workspaceScriptExample,{targetDuration:null,mode:'optimize'})).toThrow(/制作设置/);
 });
 it('accepts a 15000-character direct source and long logical shots',()=>{
  const source='原'.repeat(15000),plan=localScriptStudioPlan(source,180);expect(validateScriptStudioPlan(plan,source,{targetDuration:180,mode:'optimize'}).shots).toHaveLength(1);expect(parseProductionScript(scriptStudioText(plan))!.segments[0].settings.duration).toBe(180);
 });
 it('treats the shown estimate as the effective total and preserves English word boundaries',()=>{
  const source='A part of the street is empty.',plan=localScriptStudioPlan(source,null);
  expect(()=>validateScriptStudioPlan({...plan,durationSeconds:plan.durationSeconds+1,shots:[{...plan.shots[0],durationSeconds:plan.durationSeconds+1}]},source,{targetDuration:null,mode:'optimize'})).toThrow(/总时长/);
  expect(()=>validateScriptStudioPlan({...plan,narrationEnabled:true,shots:[{...plan.shots[0],narration:source.replace('A part','Apart')}]},source,{targetDuration:null,mode:'optimize'})).toThrow(/原文/);
 });
 it('rejects an enabled empty voice or subtitle instead of using its visual description as approved text',()=>{
  const source='朋友坐下。',base=localScriptStudioPlan(source,15),shots=[{...base.shots[0],durationSeconds:5,narration:source},{...base.shots[0],durationSeconds:10,narration:''}];
  expect(()=>validateScriptStudioPlan({...base,narrationEnabled:true,shots},source,{targetDuration:15,mode:'optimize'})).toThrow(/每个启用口播/);
  expect(()=>validateScriptStudioPlan({...base,captionsEnabled:true},source,{targetDuration:15,mode:'optimize'})).toThrow(/每个启用字幕/);
 });
 it('honors explicit subtitle-only prose and keeps its content independent from disabled voice',()=>{
  const source='画面：窗边一盏灯。\n字幕：慢一点回家。\n口播：关闭',plan=localScriptStudioPlan(source,6);expect(plan.narrationEnabled).toBe(false);expect(plan.captionsEnabled).toBe(true);expect(plan.shots[0].subtitle).toBe('慢一点回家。');
  const parsed=parseProductionScript(scriptStudioText(validateScriptStudioPlan(plan,source,{targetDuration:6,mode:'optimize'})))!;expect(parsed.segments[0].settings.captionMode).toBe('independent');expect(parsed.segments[0].subtitle).toBe('慢一点回家。');
 });
});
