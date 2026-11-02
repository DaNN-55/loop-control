import {render,screen,cleanup,within,fireEvent} from '@testing-library/react';
import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {WorkspaceCompletedShots} from './WorkspaceCompletedShots';
import {defaultShotCaptionContract} from '../shotCaptions';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
beforeEach(()=>{vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const project={activeTimelineId:'t',assets:[],timelines:[{id:'t',width:1080,height:1920,fps:30,trackOrder:[],tracks:{},transitions:[],items:[{id:'a',kind:'image',startFrame:0,durationInFrames:90,src:'product.png',loopControlShot:{shotId:'S1',clipId:'c1',text:'第一镜'}},{id:'b',kind:'video',startFrame:90,durationInFrames:60,src:'detail.mp4',srcInFrame:30,playbackRate:1,loopControlShot:{shotId:'S2',clipId:'c2',text:'第二镜'}},{id:'music',kind:'audio',startFrame:60,durationInFrames:90,volume:0.5,loopControlAudio:{kind:'bgm'}}]}]} as unknown as OpenChatCutProject;
const w={id:'w',episodeId:'e',clips:[{id:'c1',itemId:'a',shotId:'S1',text:'第一镜',source:null},{id:'c2',itemId:'b',shotId:'S2',text:'第二镜',source:null}],exports:[{current:true,confirmed:true,artifact:{relativePath:'final.mp4',sha256:'frozen'}}],captions:[{shotId:'S1',timing:'current',textConfirmed:true,contract:{...defaultShotCaptionContract('产品特写','independent'),cues:[{id:'cue',text:'产品特写',startMs:0,endMs:1000}]}}]} as unknown as ProductionWorkspace;
it('groups every shot with its own combined render window, expanded properties and overlapping music',()=>{
 render(<WorkspaceCompletedShots workspace={w} project={project}/>);
 expect(screen.getAllByRole('article')).toHaveLength(2);expect(document.querySelectorAll('video')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'展开 S1 预览'}));
 expect(screen.getByLabelText('S1 成片').getAttribute('src')).toContain('sha256=frozen');
 expect(screen.getByRole('slider',{name:'片段进度'}).getAttribute('max')).toBe('2.966666666666667');
 fireEvent.click(screen.getByRole('button',{name:'展开 S2 预览'}));
 expect(screen.queryByLabelText('S1 成片')).toBeNull();expect(screen.getByRole('slider',{name:'片段进度'}).getAttribute('min')).toBe('3');
 expect(screen.getByRole('table',{name:'S1 字幕时序'})).toBeTruthy();expect(screen.getAllByText('本镜播放区间')).toHaveLength(2);expect(document.querySelector('select,textarea')).toBeNull();expect(screen.getByText('detail.mp4')).toBeTruthy();
});
it('does not present an obsolete export as the combined shot result',()=>{
 render(<WorkspaceCompletedShots workspace={{...w,exports:[{...w.exports![0],current:false}]}} project={project}/>);expect(screen.queryByLabelText('S1 成片')).toBeNull();expect(screen.getAllByText('原素材预览')).toHaveLength(2);
});
it('formats saved transform values for viewing and omits video-only properties from images',()=>{
 const saved=structuredClone(project),image=saved.timelines[0].items[0];image.transform={scale:0.3333333333333333,rotation:15.123456789};const original=JSON.stringify(saved);
 render(<WorkspaceCompletedShots workspace={w} project={saved}/>);
 const first=screen.getByRole('article',{name:'S1 镜头配置'}),second=screen.getByRole('article',{name:'S2 镜头配置'});
 expect(first.textContent).toContain('0.333');expect(first.textContent).not.toContain('0.3333333333333333');expect(within(first).getByRole('region',{name:'S1 画面属性'}).textContent).not.toContain('播放速度');expect(first.textContent).not.toContain('片段原声');expect(within(second).getByRole('region',{name:'S2 画面属性'}).textContent).toContain('播放速度');expect(JSON.stringify(saved)).toBe(original);
});
it('does not label a saved video with stale image usage metadata',()=>{
 const oldImage={...w,clips:w.clips.map(c=>({...c,image:{usage:'pan-zoom',focusX:0.3333333333333333,focusY:0.5}}))} as ProductionWorkspace;
 render(<WorkspaceCompletedShots workspace={oldImage} project={project}/>);
 expect(screen.getByRole('article',{name:'S2 镜头配置'}).textContent).not.toContain('图片用法');
});
it('uses the adopted speech snapshot rather than subsequently edited narration parameters',()=>{
 const saved=structuredClone(project);saved.timelines[0].items.push({id:'workspace-narration-shot-S1',kind:'audio',track:'narration',startFrame:0,durationInFrames:90,sourceAssetId:'audio-track-used',src:'voice.mp3',loopControlAudio:{kind:'narration',shotId:'S1'}} as never);
 const workspace={...w,usedNarration:[{shotId:'S1',audioTrackId:'used',sha256:'used-sha',taskId:'old-task',text:'原采用正文'}],narration:[{shotId:'S1',adoptedAudioTrackId:'used',audioTrackId:'used',mode:'tts',voice:'new-editable-voice',speakingRate:1.8}],candidates:[{kind:'audio',audioTrackId:'used',sha256:'used-sha',taskId:'old-task',speech:{selection:{model:'frozen-voice-model'},voice:'frozen-voice',languageCode:'zh-CN',speakingRate:1.25}}]} as unknown as ProductionWorkspace;
 render(<WorkspaceCompletedShots workspace={workspace} project={saved}/>);
 expect(screen.getByText('frozen-voice')).toBeTruthy();expect(screen.queryByText('new-editable-voice')).toBeNull();
});
it('50 个镜头初始不加载播放器，只展开一个，切换和收起会卸载旧媒体',()=>{
 const items=Array.from({length:50},(_,i)=>({...project.timelines[0].items[1],id:`item-${i}`,src:`independent-${i}.mp4`,sourceContentHash:`sha-${i}`,startFrame:i*60,loopControlShot:{shotId:`镜头${i+1}`,clipId:`clip-${i}`,text:`独立来源 ${i+1}`}}));
 const large={...project,timelines:[{...project.timelines[0],items}]};const workspace={...w,exports:[],clips:items.map((item,i)=>({id:`clip-${i}`,itemId:item.id,shotId:`镜头${i+1}`,text:'独立来源',source:null}))};
 render(<WorkspaceCompletedShots workspace={workspace} project={large}/>);
 expect(screen.getAllByRole('article')).toHaveLength(50);expect(document.querySelectorAll('video,audio')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'展开 镜头1 预览'}));expect(document.querySelectorAll('video')).toHaveLength(1);
 const first=document.querySelector('video')!;expect(first.src).toContain('independent-0.mp4');
 fireEvent.click(screen.getByRole('button',{name:'展开 镜头50 预览'}));expect(first.isConnected).toBe(false);expect(document.querySelectorAll('video')).toHaveLength(1);expect(document.querySelector('video')!.src).toContain('independent-49.mp4');
 fireEvent.click(screen.getByRole('button',{name:'收起 镜头50 预览'}));expect(document.querySelectorAll('video')).toHaveLength(0);
});
