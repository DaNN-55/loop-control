import {expect,it} from 'vitest';
import {localScriptStudioPlan,scriptStudioText} from './scriptStudio';
import {editScriptStudioShot,deleteScriptStudioShot} from './scriptStudioEdit';
const source='画面：山间晨光。\n口播：慢一点。';
it('edits only approved shot text without mutating the source plan, timing or switches',()=>{
 const base=localScriptStudioPlan(source,15),edited=editScriptStudioShot(base,source,15,0,{title:'晨光',visual:'晨光落在山谷。',narration:'慢慢走。',subtitle:'慢慢走。'});
 expect(base.shots[0].visual).toBe(source);expect(edited.shots[0]).toMatchObject({title:'晨光',visual:'晨光落在山谷。',narration:'慢慢走。',subtitle:'慢慢走。',durationSeconds:15});expect(edited.durationSeconds).toBe(15);expect(edited.narrationEnabled).toBe(base.narrationEnabled);expect(edited.changes).toContain('包含手动修订，原文保留；镜头时长与制作设置未变。');expect(scriptStudioText(edited)).toContain('晨光落在山谷。');
});
it('rejects empty, out-of-range, non-text and control-field patches',()=>{
 const base=localScriptStudioPlan(source,15);for(const [index,fields] of [[-1,{visual:'画面'}],[1,{visual:'画面'}],[0,{}],[0,{durationSeconds:30}],[0,{settings:[]}],[0,{visual:1}],[0,{canProceed:true}]] as const)expect(()=>editScriptStudioShot(base,source,15,index,fields)).toThrow();
 expect(()=>editScriptStudioShot(base,source,15,0,{narration:''})).toThrow('每个启用口播');expect(()=>editScriptStudioShot(base,source,16,0,{visual:'新画面'})).toThrow('总时长');
});

it('deletes one shot immutably, retaining total time, switches and remaining words',()=>{
 const text='三个空镜头。',base=localScriptStudioPlan(text,10);base.shots=[1,2,3].map((n)=>({...structuredClone(base.shots[0]),title:'镜头'+n,durationSeconds:n===3?3.34:3.33}));const original=structuredClone(base),result=deleteScriptStudioShot(base,text,10,1);expect(base).toEqual(original);expect(result.shots.map(s=>s.title)).toEqual(['镜头1','镜头3']);expect(result.shots.reduce((n,s)=>n+s.durationSeconds,0)).toBe(10);expect(result.shots.map(s=>s.durationSeconds)).toEqual([4.99,5.01]);expect(result.changes.length).toBeGreaterThan(0);expect(result.narrationEnabled).toBe(false);expect(scriptStudioText(result)).not.toContain('镜头2');
});
it('rejects the last shot, invalid indexes and changed target duration when deleting',()=>{
 const base=localScriptStudioPlan(source,15);for(const index of [-1,0,1,0.5,'0'])expect(()=>deleteScriptStudioShot(base,source,15,index)).toThrow();
 const two={...base,shots:[{...base.shots[0],durationSeconds:7.5},{...base.shots[0],durationSeconds:7.5}]};expect(()=>deleteScriptStudioShot(two,source,16,0)).toThrow('总时长');
});
it('recomputes voice and caption summaries when the only enabled shot is explicitly removed',()=>{
 const text='空镜。',base=localScriptStudioPlan(text,15);base.narrationEnabled=true;base.captionsEnabled=true;base.shots=[{...base.shots[0],durationSeconds:7,narration:'一句口播。',settings:[{field:'口播启用',value:'开启'},{field:'字幕',value:'开启'}]},{...base.shots[0],durationSeconds:8,settings:[{field:'口播启用',value:'关闭'},{field:'字幕',value:'关闭'}]}];const result=deleteScriptStudioShot(base,text,15,0);expect(result).toMatchObject({narrationEnabled:false,captionsEnabled:false,durationSeconds:15});expect(result.shots[0].settings).toEqual(base.shots[1].settings);
});
