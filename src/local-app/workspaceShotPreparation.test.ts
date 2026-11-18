import {expect,it} from 'vitest';
import type {ProductionWorkspace} from '../productionWorkspace';
import {workspaceShotPreparation} from './workspaceShotPreparation';

const shot={id:'clip',itemId:'visual',shotId:'S1',text:'产品展示',source:{kind:'image',relativePath:'product.png',sha256:'sha'}};
function workspace(extra:Record<string,unknown>={}):ProductionWorkspace{return {clips:[shot],readiness:{placeholders:[],missingSources:[]},...extra} as unknown as ProductionWorkspace;}
it('accepts an explicitly used static image, without requiring disabled speech or captions',()=>{
 expect(workspaceShotPreparation(workspace({narration:[{shotId:'S1',mode:'tts',enabled:false,status:'failed'}],captions:[{shotId:'S1',contract:{enabled:false},timing:'stale'}]}),'S1',null)).toMatchObject({ready:true,label:'可剪辑',details:[]});
});
it('does not count a retained reference image as the final shot visual',()=>{
 const value=workspace({clips:[{...shot,source:null}],selectedImages:[{targetItemId:'visual',candidateId:'ref'}]});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:false,label:'缺画面',next:'visual'});
});
it('counts enabled narration even when the saved mode is none until it is used',()=>{
 expect(workspaceShotPreparation(workspace({narration:[{shotId:'S1',mode:'none',enabled:true,status:'draft'}]}),'S1',null)).toMatchObject({ready:false,label:'缺口播',next:'voice'});
});
it('requires current subtitles but never a per-shot human approval',()=>{
 const value=workspace({captions:[{shotId:'S1',contract:{enabled:true},timing:'stale',textConfirmed:false}]});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({label:'字幕待调整',next:'voice'});
 value.captions![0].timing='current';
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:true,label:'可剪辑'});
});
it('checks every visual slot and summarizes multiple missing requirements',()=>{
 const value=workspace({clips:[shot,{...shot,id:'clip2',itemId:'visual2',source:null}],narration:[{shotId:'S1',mode:'tts',enabled:true,status:'draft'}]});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({label:'还缺 2 项',details:['缺画面','缺口播']});
});
it('does not invalidate used speech because another generation failed',()=>{
 expect(workspaceShotPreparation(workspace({narration:[{shotId:'S1',mode:'tts',enabled:true,status:'failed',adoptedAudioTrackId:'used'}]}),'S1',null).ready).toBe(true);
});
it('does not count retained narration as the newly requested video voice',()=>{
 const value=workspace({narration:[{shotId:'S1',mode:'tts',enabled:false,requestedMode:'source',adoptedAudioTrackId:'old'}],audio:{mix:{voices:[{shotId:'S1',mode:'none'}],sounds:[]},preparations:[]}});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:false,label:'缺视频原声'});
});
it('only requires a requested enabled shot effect, never a whole-episode music choice',()=>{
 const value=workspace({clips:[{...shot,soundIntent:'开门声'}],audio:{enabled:{sfx:true,bgm:true},preparations:[],mix:{voices:[],sounds:[]}}});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({label:'缺音效',next:'sound'});
 value.audio!.enabled!.sfx=false;
 expect(workspaceShotPreparation(value,'S1',null).ready).toBe(true);
});

it('does not call an adopted unreadable voice file ready',()=>{
 const value=workspace({narration:[{shotId:'S1',mode:'tts',enabled:true,adoptedAudioTrackId:'used',relativePath:'voice.mp3'}],readiness:{placeholders:[],missingSources:['voice.mp3']}});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:false,label:'缺口播'});
});

it('keeps a prepared shot ready while another visual candidate is being generated',()=>{
 const value=workspace({visualTasks:[{shotId:'S1',status:'running'}]});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:true,label:'可剪辑',tone:'ready'});
});
