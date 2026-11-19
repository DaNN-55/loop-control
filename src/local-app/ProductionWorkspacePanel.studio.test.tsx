import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
const workspace={id:'w',episodeId:'e',workflowVersion:'four-step/v1',scriptRevisionId:'s',revision:1,clips:[{id:'c',shotId:'S1',itemId:'shot-S1-clip',text:'第一镜',source:null}],project:{relativePath:'project.json',sha256:'a'.repeat(64),fileSize:2,projectId:'loop-control-e'},readiness:{deliverable:false,placeholders:['shot-S1-clip'],missingSources:[]},stale:false};
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
function setup(){
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>Response.json(path==='/api/local/connections'?{serviceCatalog:{version:1,groups:[]}}:{workspace})));
 const command=vi.fn(async()=>({productionWorkspace:workspace,workspace:{...workspace.project,relativePath:'work/project.json'},studioUrl:'http://127.0.0.1:5175/?lcBridge=1#/editor/loop-control-e'}));
 render(<ProductionWorkspacePanel episodeId="e" title="剪辑承接" scriptRevisionId="s" materials={[]} command={command} onLegacy={()=>{}}/>);return command;
}
it('keeps shot sound preparation in the storyboard and offers music only inside the editor tools',async()=>{
 const command=setup();fireEvent.click(await screen.findByRole('tab',{name:'音效'}));
 expect(screen.queryByRole('button',{name:'整期配乐'})).toBeNull();expect(screen.getByLabelText('音效意图或检索词')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'进入剪辑工作台'}));
 fireEvent.click(await screen.findByRole('button',{name:'补充工具'}));
 expect(screen.getByRole('button',{name:'配乐与音效'})).toBeTruthy();expect(screen.getByRole('button',{name:'整期配乐'})).toBeTruthy();
 expect(command).toHaveBeenCalledExactlyOnceWith('openWorkspaceStudio',expect.objectContaining({workspaceId:'w'}));
});
it('offers a direct file picker inside the editor instead of referring to the absent storyboard shelf',async()=>{
 setup();fireEvent.click(await screen.findByRole('button',{name:'进入剪辑工作台'}));
 const frame=await screen.findByTitle('OpenChatCut 剪辑工程') as HTMLIFrameElement,url=new URL(frame.src);
 fireEvent(window,new MessageEvent('message',{origin:url.origin,source:frame.contentWindow!,data:{type:'loop-control:state',channel:url.searchParams.get('lcChannel'),projectId:'loop-control-e',revision:1,writable:true,items:[{id:'shot-S1-clip',startFrame:0,durationInFrames:150,kind:'text'}],shots:[{id:'S1',text:'第一镜',itemIds:['shot-S1-clip']}],selectedIds:['shot-S1-clip']}}));
 fireEvent.click(screen.getByRole('button',{name:'补充工具'}));fireEvent.click(screen.getByRole('button',{name:'画面与候选'}));
 expect(await screen.findByRole('button',{name:/选择或拖入图片/})).toBeTruthy();expect(screen.getByLabelText('上传图片素材')).toBeTruthy();
});
