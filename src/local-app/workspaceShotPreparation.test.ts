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
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:false,label:'待1项',next:'visual'});
});
it('counts enabled narration even when the saved mode is none until it is used',()=>{
 expect(workspaceShotPreparation(workspace({narration:[{shotId:'S1',mode:'none',enabled:true,status:'draft'}]}),'S1',null)).toMatchObject({ready:false,label:'待1项',next:'voice'});
});
it('requires current subtitles but never a per-shot human approval',()=>{
 const value=workspace({captions:[{shotId:'S1',contract:{enabled:true},timing:'stale',textConfirmed:false}]});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({label:'待1项',next:'voice'});
 value.captions![0].timing='current';
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:true,label:'可剪辑'});
});
it('checks every visual slot and summarizes multiple missing requirements',()=>{
 const value=workspace({clips:[shot,{...shot,id:'clip2',itemId:'visual2',source:null}],narration:[{shotId:'S1',mode:'tts',enabled:true,status:'draft'}]});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({label:'待2项',details:['缺画面','缺口播']});
});
it('does not invalidate used speech because another generation failed',()=>{
 expect(workspaceShotPreparation(workspace({narration:[{shotId:'S1',mode:'tts',enabled:true,status:'failed',adoptedAudioTrackId:'used'}]}),'S1',null).ready).toBe(true);
});
it('does not count retained narration as the newly requested video voice',()=>{
 const value=workspace({narration:[{shotId:'S1',mode:'tts',enabled:false,requestedMode:'source',adoptedAudioTrackId:'old'}],audio:{mix:{voices:[{shotId:'S1',mode:'none'}],sounds:[]},preparations:[]}});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:false,label:'待1项'});
});
it('only requires a requested enabled shot effect, never a whole-episode music choice',()=>{
 const value=workspace({clips:[{...shot,soundIntent:'开门声'}],audio:{enabled:{sfx:true,bgm:true},preparations:[],mix:{voices:[],sounds:[]}}});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({label:'待1项',next:'sound'});
 value.audio!.enabled!.sfx=false;
 expect(workspaceShotPreparation(value,'S1',null).ready).toBe(true);
});

it('does not call an adopted unreadable voice file ready',()=>{
 const value=workspace({narration:[{shotId:'S1',mode:'tts',enabled:true,adoptedAudioTrackId:'used',relativePath:'voice.mp3'}],readiness:{placeholders:[],missingSources:['voice.mp3']}});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:false,label:'待1项'});
});

it('keeps a prepared shot ready while another visual candidate is being generated',()=>{
 const value=workspace({visualTasks:[{shotId:'S1',status:'running'}]});
 expect(workspaceShotPreparation(value,'S1',null)).toMatchObject({ready:true,label:'可剪辑',tone:'ready'});
});

it('always describes picture, main voice and captions, without counting disabled features',()=>{
 const result=workspaceShotPreparation(workspace({narration:[{shotId:'S1',enabled:false,requestedMode:'none'}],captions:[{shotId:'S1',contract:{enabled:false},timing:'stale'}]}),'S1',null);
 expect(result.items).toMatchObject([{id:'visual',status:'complete'},{id:'voice',status:'disabled'},{id:'captions',status:'disabled'}]);
 expect(result).toMatchObject({ready:true,label:'可剪辑',pendingCount:0});
});
it('derives the missing count and summary from the same item states',()=>{
 const result=workspaceShotPreparation(workspace({clips:[{...shot,source:null}],narration:[{shotId:'S1',enabled:true,requestedMode:'tts'}],captions:[{shotId:'S1',contract:{enabled:true},timing:'waiting'}]}),'S1',null);
 expect(result.items.map(i=>i.id)).toEqual(['visual','voice','captions']);
 expect(result.pendingCount).toBe(result.items.filter(i=>i.status==='pending').length);
 expect(result).toMatchObject({ready:false,label:'待3项',pendingCount:3});
 expect(result.items[2]).toMatchObject({status:'pending',statusLabel:'同步中'});
});
it('adds a fourth effect item only when it is enabled and explicitly requested',()=>{
 const value=workspace({clips:[{...shot,soundIntent:'开门声'}],audio:{enabled:{sfx:true,bgm:true},preparations:[],mix:{voices:[],sounds:[]}}});
 expect(workspaceShotPreparation(value,'S1',null).items).toHaveLength(4);
 expect(workspaceShotPreparation(value,'S1',null).items[3]).toMatchObject({id:'sound',status:'pending'});
 value.audio!.enabled!.sfx=false;
 expect(workspaceShotPreparation(value,'S1',null).items).toHaveLength(3);
});
it('does not mark retained source audio complete after the video source changes',()=>{
 const result=workspaceShotPreparation(workspace({narration:[{shotId:'S1',requestedMode:'source'}],audio:{preparations:[],mix:{sounds:[],voices:[{shotId:'S1',mode:'source',sourceCurrent:false}]}}}),'S1',null);
 expect(result.items[1]).toMatchObject({id:'voice',status:'pending',statusLabel:'需重接'});
 expect(result).toMatchObject({ready:false,pendingCount:1});
});
it.each(['failed','submitted_unknown'])('does not mark an unadopted voice complete when generation is %s',status=>{
 const result=workspaceShotPreparation(workspace({narration:[{shotId:'S1',enabled:true,status}]}),'S1',null);
 expect(result.items[1]).toMatchObject({status:'pending'});expect(result.ready).toBe(false);
});
