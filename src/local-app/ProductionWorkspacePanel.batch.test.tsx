import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
const sha='a'.repeat(64);
const project={version:3,activeTimelineId:'t',assets:[],mediaFolders:[],timelines:[{id:'t',name:'当前工程',order:0,fps:30,width:1080,height:1920,fit:'contain',trackOrder:[],tracks:{},transitions:[],selectedId:null,captionsHidden:false,items:[{id:'a',kind:'text',startFrame:0,durationInFrames:90,loopControlShot:{shotId:'S1',clipId:'c1',text:'第一镜'}}]}]} as OpenChatCutProject;
const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',storyboardPackageId:null,revision:1,contentSha256:sha,stale:false,history:[],project:{relativePath:'current.json',sha256:sha,fileSize:100,projectId:'loop-control-e'},clips:[{id:'c1',itemId:'a',shotId:'S1',text:'第一镜',source:null}],readiness:{deliverable:false,placeholders:['a'],missingSources:[]}} as ProductionWorkspace;
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;fireEvent(this,new Event('close'));}});
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();});
it('keeps only the original single-shot split workspace after batch preparation and review are withdrawn',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.includes('/workspace/project?')?{project}:path.includes('connections')?{serviceCatalog:{version:1,groups:[]}}:{workspace})));
 const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="批量制作" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByRole('table',{name:'镜头'});
 expect(screen.queryByRole('button',{name:/批量准备|集中核对/})).toBeNull();
 expect(screen.queryByRole('combobox',{name:'批量准备内容'})).toBeNull();
 expect(screen.queryByRole('separator',{name:'调整镜头列表宽度'})).toBeNull();
 expect(screen.getByRole('table',{name:'镜头'})).toBeTruthy();
 expect(screen.getAllByRole('table')).toHaveLength(1);
 expect(screen.getByRole('tab',{name:'画面'})).toBeTruthy();
 expect(screen.queryByRole('checkbox',{name:'选择镜头 S1'})).toBeNull();
 expect(screen.getByRole('button',{name:'选择镜头 01'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'镜头与素材'})).toBeNull();
 expect(screen.queryByRole('dialog')).toBeNull();expect(command).not.toHaveBeenCalled();
});
it('retains single-shot preparation when the saved native project is unavailable',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path.includes('/workspace/project?')?{project:null}:path.includes('connections')?{serviceCatalog:{version:1,groups:[]}}:{workspace})));
 const command=vi.fn();render(<ProductionWorkspacePanel episodeId="e" title="读取恢复" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 await screen.findByText('第一镜');await waitFor(()=>expect(screen.queryByText('正在读取制作流程…')).toBeNull());
 expect(screen.queryByRole('button',{name:/批量准备/})).toBeNull();expect(screen.queryByRole('separator',{name:'调整镜头列表宽度'})).toBeNull();expect(command).not.toHaveBeenCalled();
});
