import {expect,it} from 'vitest';
import {localScriptStudioPlan,validateScriptStudioPlan,type ScriptStudioOptions} from './scriptStudio';
import {scriptStudioReceiptOptions} from './scriptStudioLegacy';
it('adopts a historical content revision through a read-only compatibility boundary',()=>{
 const source='原来的画面。',plan=localScriptStudioPlan(source,15),stored={targetDuration:15,mode:'adapt',instruction:'历史修改要求'},before=structuredClone(stored);
 const changed={...plan,changes:['历史新增台词'],narrationEnabled:true,shots:[{...plan.shots[0],narration:'原来的一句话。'}]};
 expect(validateScriptStudioPlan(changed,source,scriptStudioReceiptOptions(stored)).changes).toEqual(['历史新增台词']);expect(stored).toEqual(before);
});
it.each(['adapt','unknown'])('refuses unnormalized modes in the current validator (%s)',mode=>{
 const plan=localScriptStudioPlan('原文。',15);expect(()=>validateScriptStudioPlan(plan,'原文。',{targetDuration:15,mode} as ScriptStudioOptions)).toThrow(/模式/);
});
it('requires content changes to be listed for a current revision',()=>{
 const plan=localScriptStudioPlan('原文。',15);expect(()=>validateScriptStudioPlan(plan,'原文。',{targetDuration:15,mode:'revision'})).toThrow(/变化/);
});
