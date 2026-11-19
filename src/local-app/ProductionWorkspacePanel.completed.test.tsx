import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import {defaultShotCaptionContract} from '../shotCaptions';

const sha='a'.repeat(64);
const project={version:3,activeTimelineId:'t',assets:[],timelines:[{id:'t',name:'已保存时间线',fps:30,width:1080,height:1920,trackOrder:[],tracks:{},transitions:[],items:[
 {id:'a',kind:'image',src:'first.png',startFrame:0,durationInFrames:90,loopControlShot:{shotId:'S1',clipId:'c1',text:'第一镜'}},
 {id:'b',kind:'video',src:'second.mp4',startFrame:90,durationInFrames:60,loopControlShot:{shotId:'S2',clipId:'c2',text:'第二镜'}},
]}]} as unknown as OpenChatCutProject;
const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:2,contentSha256:sha,stale:false,
 project:{relativePath:'saved.json',sha256:sha,fileSize:100,projectId:'loop-control-e'},history:[],
 clips:[{id:'c1',itemId:'a',shotId:'S1',text:'第一镜',source:null},{id:'c2',itemId:'b',shotId:'S2',text:'第二镜',source:null}],
 readiness:{deliverable:true,placeholders:[],missingSources:[]},
 captions:[{shotId:'S1',timing:'current',textConfirmed:true,contract:defaultShotCaptionContract('字幕正文','independent')}],
 exports:[{id:'export',projectContentVersion:2,contentSha256:sha,project:{relativePath:'saved.json',sha256:sha,fileSize:100},status:'ready',current:true,confirmed:true,checks:[],artifact:{relativePath:'final.mp4',sha256:sha,fileSize:100}}],
 exportIssues:[{id:'issue',exportId:'export',reason:'首镜字幕出现三行',resolved:false}],
} as unknown as ProductionWorkspace;

beforeEach(()=>{
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;fireEvent(this,new Event('close'));}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function setup(stage='production_completed',data=workspace){
 const reads=vi.fn(async(path:string,init?:RequestInit)=>{if(path==='/api/local/session')return Response.json({owner:{id:'owner'},csrfToken:'a'.repeat(64)});if(path.endsWith('/studio-copy')){const body=JSON.parse(String(init?.body));return Response.json(body.action==='open'?{copyId:body.copyId,sourceSha256:sha,studioUrl:`http://127.0.0.1:5678/?lcBridge=1#/editor/loop-control-${body.copyId}`,workspace:{projectId:'loop-control-'+body.copyId,relativePath:'copy.json',sha256:sha,fileSize:1},sourcePath:'copy.json'}:{closed:true});}return Response.json(path.includes('/workspace/project?')?{project}:{workspace:data});});vi.stubGlobal('fetch',reads);
 const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="已完成作品" scriptRevisionId="s" materials={[]} stage={stage} command={command} onLegacy={()=>{}}/>);
 return {reads,command};
}
it('uses three completed-work sections and opens only an isolated Studio copy without production writes',async()=>{
 const {command,reads}=setup();
 await waitFor(()=>expect(screen.queryByText('正在读取制作流程…')).toBeNull());
 const nav=screen.getByRole('navigation',{name:'作品查看'});
 expect(within(nav).getAllByRole('button').map(button=>button.textContent)).toHaveLength(3);
 expect(within(nav).queryByRole('button',{name:/剪辑工作台/})).toBeNull();
 fireEvent.click(within(nav).getByRole('button',{name:/分镜台/}));
 await screen.findByRole('table',{name:'镜头'});
 expect(screen.getByRole('separator',{name:'调整镜头列表宽度'})).toBeTruthy();
 expect(screen.getAllByRole('table')).toHaveLength(1);
 expect(screen.queryByRole('dialog')).toBeNull();
 const quality=document.querySelector('.workspace-preparation .completed-quality');
 expect(quality).toBeNull();
 expect(screen.queryByText('问题与复核记录')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'在 OpenChatCut 中查看'}));
 await screen.findByRole('region',{name:'OpenChatCut 查看副本'});
 await screen.findByTitle('OpenChatCut 查看副本');
 expect(document.querySelector('iframe')?.src).toContain('lcProject=loop-control-');
 fireEvent.click(screen.getByRole('button',{name:'返回分镜台'}));
 await waitFor(()=>expect(screen.getByRole('table',{name:'镜头'})).toBeTruthy());
 expect(command).not.toHaveBeenCalled();
 expect(reads.mock.calls.filter(([,init])=>init?.method&&init.method!=='GET').every(([path])=>path.endsWith('/studio-copy'))).toBe(true);
});
it('keeps completed shot details inline and restores the selected shot and tab after viewing the project',async()=>{
 const {command}=setup();
 await waitFor(()=>expect(screen.queryByText('正在读取制作流程…')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:/分镜台/}));
 await screen.findByRole('table',{name:'镜头'});
 fireEvent.click(screen.getByRole('button',{name:'选择镜头 02'}));
 fireEvent.click(screen.getByRole('tab',{name:'字幕与口播'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(screen.queryByRole('button',{name:/批量准备/})).toBeNull();
 expect(screen.getByRole('row',{name:'镜头 02'}).getAttribute('aria-selected')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'在 OpenChatCut 中查看'}));
 await screen.findByRole('region',{name:'OpenChatCut 查看副本'});
 fireEvent.click(screen.getByRole('button',{name:'返回分镜台'}));
 await screen.findByRole('table',{name:'镜头'});
 expect(screen.getByRole('tab',{name:'字幕与口播'}).getAttribute('aria-selected')).toBe('true');
 expect(screen.getByRole('row',{name:'镜头 02'}).getAttribute('aria-selected')).toBe('true');
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(command).not.toHaveBeenCalled();
});
it('retains four production steps on unfinished orders',async()=>{
 setup('storyboard_approved');
 expect(screen.getByRole('navigation',{name:'四步制作步骤'}).querySelectorAll('button')).toHaveLength(4);
 await waitFor(()=>expect(screen.queryByText('正在读取制作流程…')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:/分镜台/}));
 await screen.findByText('第一镜');
 expect(screen.queryByRole('table',{name:'全片镜头总览'})).toBeNull();
});
