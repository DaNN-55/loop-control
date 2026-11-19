import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:1,clips:[{id:'c',shotId:'S1',itemId:'shot-S1-clip',text:'第一镜',source:null}],project:{relativePath:'project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:['shot-S1-clip'],missingSources:[]},stale:false};
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('keeps preparation on the storyboard and only native editing in the editor',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path==='/api/local/connections'?{serviceCatalog:{version:1,groups:[]}}:{workspace})));
 const command=vi.fn(async()=>({productionWorkspace:{...workspace,editorAuthority:'native'},workspace:{...workspace.project,relativePath:'work/project.json'},studioUrl:'http://127.0.0.1:5175/?lcBridge=1#/editor/loop-control-e'}));
 render(<ProductionWorkspacePanel episodeId="e" title="剪辑承接" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);
 fireEvent.click(await screen.findByRole('tab',{name:'音效'}));expect(screen.getByLabelText('音效意图或检索词')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'进入剪辑工作台'}));
 const frame=await screen.findByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,url=new URL(frame.src);
 expect(screen.queryByRole('button',{name:'补充工具'})).toBeNull();expect(screen.queryByLabelText('上传图片素材')).toBeNull();
 fireEvent(window,new MessageEvent('message',{origin:url.origin,source:frame.contentWindow!,data:{type:'loop-control:import-requested',channel:url.searchParams.get('lcChannel'),projectId:'loop-control-e',kind:'image'}}));
 expect(screen.queryByRole('button',{name:'画面与候选'})).toBeNull();expect(screen.getByTitle('OpenChatCut 剪辑工程')).toBe(frame);
 expect(command).toHaveBeenCalledExactlyOnceWith('openWorkspaceStudio',expect.objectContaining({workspaceId:'w'}));
});
