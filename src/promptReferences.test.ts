import {expect,it} from 'vitest';
import {promptReferenceOptions,resolvePromptReferences} from './promptReferences';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',v='33333333-3333-4333-8333-333333333333';
const inputs=[{materialRevisionId:a,kind:'image' as const,name:'A.png'},{materialRevisionId:b,kind:'image' as const,name:'B.png'}];
const bindings=[{token:'@图片1',materialRevisionId:a},{token:'@图片2',materialRevisionId:b}];
it('keeps mention identities after reordering and never reuses a removed reference alias',()=>{
 expect(promptReferenceOptions([inputs[1],inputs[0]],bindings).map(input=>input.token)).toEqual(['@图片2','@图片1']);
 expect(promptReferenceOptions([{...inputs[0],materialRevisionId:v}],bindings)[0].token).toBe('@图片3');
 expect(promptReferenceOptions([inputs[0],inputs[0]])).toHaveLength(1);
 expect(resolvePromptReferences('让@图片1 站在@图片2旁',[...bindings],[inputs[1],inputs[0]])).toBe('让参考图 2 站在参考图 1旁');
});
it('compiles MiniMax reference labels with independent image/video order and Wan character order',()=>{
 const mixed=[inputs[0],{materialRevisionId:v,kind:'video' as const,name:'V.mp4'},inputs[1]],all=[...bindings,{token:'@视频1',materialRevisionId:v}];
 expect(resolvePromptReferences('@图片2 跟随 @视频1',all,mixed,{provider:'minimax',referenceMode:true})).toBe('<Picture 2> 跟随 <Video 1>');
 expect(resolvePromptReferences('@图片2 跟随 @视频1',all,mixed,{provider:'bailian',characterOrder:true})).toBe('character3 跟随 character2');
 expect(resolvePromptReferences('@图片2',all,mixed,{provider:'volcengine',referenceMode:true})).toBe('图片2');
 expect(resolvePromptReferences('@图片1',bindings,[{...inputs[0],role:'lastFrame'}],{provider:'minimax'})).toBe('尾帧图像');
});
it('compiles Kling Omni mentions to native image/video identifiers after reordering',()=>{
 const mixed=[inputs[1],{materialRevisionId:v,kind:'video' as const,name:'V.mp4'},inputs[0]];
 expect(resolvePromptReferences('@图片1 跟随 @视频1',[...bindings,{token:'@视频1',materialRevisionId:v}],mixed,{provider:'kling',referenceMode:true})).toBe('<<<image_2>>> 跟随 <<<video_1>>>');
});
it('blocks missing, ambiguous and forged references while leaving ordinary text alone',()=>{
 expect(()=>resolvePromptReferences('@图片1',bindings,[inputs[1]])).toThrow('已移除');
 expect(()=>resolvePromptReferences('@图片1',undefined,inputs)).toThrow('已移除');
 expect(()=>resolvePromptReferences('@图片1',[...bindings,bindings[0]],inputs)).toThrow('重复');
 expect(()=>resolvePromptReferences('@视频1',[{token:'@视频1',materialRevisionId:a}],inputs)).toThrow('类型不匹配');
 expect(()=>resolvePromptReferences('prompt',[{token:'@图片1',materialRevisionId:'not-id'}],inputs)).toThrow('无效');
 expect(resolvePromptReferences('联系 a@example.com，保留首帧',undefined,inputs)).toBe('联系 a@example.com，保留首帧');
});
