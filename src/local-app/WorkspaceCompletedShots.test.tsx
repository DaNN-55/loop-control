import {render,screen,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {WorkspaceCompletedShots} from './WorkspaceCompletedShots';
import {defaultShotCaptionContract} from '../shotCaptions';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
vi.mock('../operations/WorkbenchVideoPlayer',()=>({WorkbenchVideoPlayer:({source,segment,title}:any)=><video aria-label={title} src={source} data-start={segment.start} data-end={segment.end}/>}));
afterEach(cleanup);
const project={activeTimelineId:'t',assets:[],timelines:[{id:'t',width:1080,height:1920,fps:30,trackOrder:[],tracks:{},transitions:[],items:[{id:'a',kind:'image',startFrame:0,durationInFrames:90,src:'product.png',loopControlShot:{shotId:'S1',clipId:'c1',text:'第一镜'}},{id:'b',kind:'video',startFrame:90,durationInFrames:60,src:'detail.mp4',srcInFrame:30,playbackRate:1,loopControlShot:{shotId:'S2',clipId:'c2',text:'第二镜'}},{id:'music',kind:'audio',startFrame:60,durationInFrames:90,volume:0.5,loopControlAudio:{kind:'bgm'}}]}]} as unknown as OpenChatCutProject;
const w={id:'w',episodeId:'e',clips:[{id:'c1',itemId:'a',shotId:'S1',text:'第一镜',source:null},{id:'c2',itemId:'b',shotId:'S2',text:'第二镜',source:null}],exports:[{current:true,confirmed:true,artifact:{relativePath:'final.mp4',sha256:'frozen'}}],captions:[{shotId:'S1',timing:'current',textConfirmed:true,contract:{...defaultShotCaptionContract('产品特写','independent'),cues:[{id:'cue',text:'产品特写',startMs:0,endMs:1000}]}}]} as unknown as ProductionWorkspace;
it('groups every shot with its own combined render window, expanded properties and overlapping music',()=>{
 render(<WorkspaceCompletedShots workspace={w} project={project}/>);
 expect(screen.getAllByRole('article')).toHaveLength(2);expect(screen.getByLabelText('S1 成片').getAttribute('data-end')).toBe('3');expect(screen.getByLabelText('S2 成片').getAttribute('data-start')).toBe('3');expect(screen.getByLabelText('S2 成片').getAttribute('src')).toContain('sha256=frozen');expect(screen.getByRole('table',{name:'S1 字幕时序'})).toBeTruthy();expect(screen.getAllByText('本镜播放区间')).toHaveLength(2);expect(document.querySelector('details,input,select,textarea')).toBeNull();expect(screen.getByText('detail.mp4')).toBeTruthy();
});
it('does not present an obsolete export as the combined shot result',()=>{
 render(<WorkspaceCompletedShots workspace={{...w,exports:[{...w.exports![0],current:false}]}} project={project}/>);expect(screen.queryByLabelText('S1 成片')).toBeNull();expect(screen.getAllByText('原素材预览')).toHaveLength(2);
});
