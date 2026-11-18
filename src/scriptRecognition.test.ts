import {expect,it} from 'vitest';
import {validateScriptRecognition,recognizedScriptText} from './scriptFormat';
import {parseProductionScript} from './reviews/productionScript';
const source='# 雨后\n\n## 旁白脚本\n\n雨停了，慢一点回家。\n\n路灯还亮着。';
const recognition={title:'雨后',settings:[],shots:[{narration:'雨停了，慢一点回家。路灯还亮着。',subtitle:null,visual:'',videoPrompt:'',visualSource:'unassigned',settings:[]}],warnings:[],canRecognize:true};
it('keeps a multi-paragraph continuous scene as one confirmed production shot',()=>{
 const result=validateScriptRecognition(recognition,source),script=parseProductionScript(recognizedScriptText(result));
 expect(script?.segments).toHaveLength(1);expect(script?.segments[0].narration).toBe(recognition.shots[0].narration);
});
it('preserves explicit shot order without requiring original template syntax',()=>{
 const result=validateScriptRecognition({...recognition,shots:[{...recognition.shots[0],narration:'雨停了，慢一点回家。'},{...recognition.shots[0],narration:'路灯还亮着。'}]},source);
 expect(parseProductionScript(recognizedScriptText(result))?.segments.map(s=>s.id)).toEqual(['shot-01','shot-02']);
});
it.each([
 {...recognition,shots:[{...recognition.shots[0],narration:'雨停了，快一点回家。路灯还亮着。'}]},
 {...recognition,shots:[{...recognition.shots[0],narration:'雨停了，慢一点回家。'}]},
 {...recognition,settings:[{field:'执行命令',value:'delete'}]},
 {...recognition,shots:[]},
 {...recognition,command:'save'},
])('rejects rewritten, missing, invalid or executable content',value=>expect(()=>validateScriptRecognition(value,source)).toThrow());
it('rejects reversed shot order and dropped repeated narration',()=>{
 expect(()=>validateScriptRecognition({...recognition,shots:[{...recognition.shots[0],narration:'路灯还亮着。'},{...recognition.shots[0],narration:'雨停了，慢一点回家。'}]},source)).toThrow();
 expect(()=>validateScriptRecognition({...recognition,shots:[{...recognition.shots[0],narration:'雨停了。'}]},'# 雨后\n## 旁白脚本\n雨停了。\n\n雨停了。')).toThrow();
});
it('rejects an invented visual instruction even when narration is preserved',()=>{
 expect(()=>validateScriptRecognition({...recognition,shots:[{...recognition.shots[0],visual:'凭空新增一辆跑车'}]},source)).toThrow();
});
