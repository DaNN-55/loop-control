import {it,expect} from 'vitest';
import {applyInitialWorkspaceTemplateSettings} from './workspaceTemplateSettings';
import {parseProductionScript,segmentSettings} from './reviews/productionScript';
import type {OpenChatCutProject} from './worker/openchatcutProject';
const project=():OpenChatCutProject=>({version:3,assets:[],mediaFolders:[],activeTimelineId:'t',timelines:[{id:'t',name:'t',order:0,fps:30,width:360,height:640,fit:'contain',items:[{id:'a',kind:'image',track:'V1',startFrame:0,durationInFrames:60,transform:{scale:1}},{id:'b',kind:'image',track:'V1',startFrame:60,durationInFrames:90,transform:{scale:1},loopControlShot:{shotId:'b',renderPreferences:{version:'workspace-render-preferences/v2',scale:1.2,animation:'slow-push',animationAmount:0,transition:'anticipation-zoom',transitionDuration:.4}}}],tracks:{V1:{kind:'video',name:'画面'}},trackOrder:['V1'],transitions:[],selectedId:null,captionsHidden:false}]});
it('maps explicit aliases, blank/default inherits while close and zero remain explicit',()=>{
 const script=parseProductionScript('# 模板\n## 制作设置\n- 模板版本：3\n- 转场：轻推\n- 动画：慢推\n- 缩放：1.2\n## 正文\n### 段落 01\n- 口播：第一段\n- 画面来源：图片\n- 转场：\n- 动画幅度（%）：0\n### 段落 02\n- 口播：第二段\n- 画面来源：图片\n- 转场：关闭\n- 动画：无\n')!;
 expect(segmentSettings(script,script.segments[0])).toMatchObject({transition:'anticipation-zoom',animation:'slow-push',animationAmount:0,scale:1.2});
 expect(segmentSettings(script,script.segments[1])).toMatchObject({transition:'cut',animation:'none'});
 expect(()=>parseProductionScript('# 模板\n## 制作设置\n- 模板版本：3\n- 转场：任意插件\n## 正文')).toThrow();
});
it('applies filled scale and native duration-normalized animation and creates a real adjacent transition once',()=>{
 const next=project(),before=structuredClone(next);before.timelines[0].items[1].kind='text';
 applyInitialWorkspaceTemplateSettings(before,next);
 expect(next.timelines[0].items[1]).toMatchObject({transform:{scale:1.2},zoom:{magnification:1,envelope:[0,1]}});
 expect(next.timelines[0].transitions).toEqual([{id:'template-transition-b',type:'anticipation-zoom',durationInFrames:12,outgoingItemId:'a',incomingItemId:'b',trackId:'V1'}]);
 const edited=structuredClone(next);edited.timelines[0].items[1].transform={scale:1.8};edited.timelines[0].transitions=[];applyInitialWorkspaceTemplateSettings(next,edited);
 expect(edited.timelines[0].items[1].transform).toEqual({scale:1.8});expect(edited.timelines[0].transitions).toEqual([]);
});
it('does not add absent settings or move voice timing and rejects missing video handles',()=>{
 const next=project();delete next.timelines[0].items[1].loopControlShot;next.timelines[0].items.push({id:'voice',kind:'audio',track:'A1',startFrame:60,durationInFrames:90,src:'voice.mp3'});
 const before=structuredClone(next);before.timelines[0].items[1].kind='text';applyInitialWorkspaceTemplateSettings(before,next);expect(next.timelines[0].items.at(-1)).toEqual(before.timelines[0].items.at(-1));expect(next.timelines[0].transitions).toEqual([]);
 const video=project();video.timelines[0].items[1].kind='video';video.timelines[0].items[1].srcInFrame=0;const old=structuredClone(video);old.timelines[0].items[1].kind='text';expect(()=>applyInitialWorkspaceTemplateSettings(old,video)).toThrow('源素材余量');
});
it.each(['cut',undefined])('keeps a hard cut for %s without adding a transition',transition=>{
 const next=project();((next.timelines[0].items[1].loopControlShot as any).renderPreferences).transition=transition;const old=structuredClone(next);old.timelines[0].items[1].kind='text';applyInitialWorkspaceTemplateSettings(old,next);expect(next.timelines[0].transitions).toEqual([]);
});
it('honors transition duration zero and validates real video source handles without altering audio',()=>{
 const next=project(),incoming=next.timelines[0].items[1];incoming.kind='video';incoming.sourceAssetId='source';incoming.srcInFrame=6;
 next.assets.push({id:'source',kind:'video',name:'source',src:'source.mp4',durationInFrames:120});
 const before=structuredClone(next);before.timelines[0].items[1].kind='text';applyInitialWorkspaceTemplateSettings(before,next);expect(next.timelines[0].transitions).toHaveLength(1);expect(incoming.srcInFrame).toBe(6);
 const zero=project();(zero.timelines[0].items[1].loopControlShot as any).renderPreferences.transitionDuration=0;const old=structuredClone(zero);old.timelines[0].items[1].kind='text';applyInitialWorkspaceTemplateSettings(old,zero);expect(zero.timelines[0].transitions).toEqual([]);
});
it('waits for the immediately preceding placeholder when sources are adopted out of order',()=>{
 const next=project();next.timelines[0].items[0].kind='text';const before=structuredClone(next);before.timelines[0].items[1].kind='text';applyInitialWorkspaceTemplateSettings(before,next);expect(next.timelines[0].transitions).toEqual([]);
 const waiting=structuredClone(next);next.timelines[0].items[0].kind='image';applyInitialWorkspaceTemplateSettings(waiting,next);expect(next.timelines[0].transitions).toHaveLength(1);
});
it('keeps a positive sub-frame transition distinct from an explicit zero',()=>{
 const next=project();(next.timelines[0].items[1].loopControlShot as any).renderPreferences.transitionDuration=.01;const before=structuredClone(next);before.timelines[0].items[1].kind='text';applyInitialWorkspaceTemplateSettings(before,next);expect(next.timelines[0].transitions[0].durationInFrames).toBe(1);
});
