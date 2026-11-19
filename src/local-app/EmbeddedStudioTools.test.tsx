import {act,fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {EmbeddedStudioTools} from './EmbeddedStudioTools';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
vi.mock('./WorkspaceAudioPanel',()=>({WorkspaceAudioPreparation:({bridge,studioTools,onBusyChange}:any)=><><p>{bridge&&studioTools?'原生声音候选':'错误'}</p><button onClick={()=>onBusyChange?.(true)}>模拟声音采用</button></>}));
vi.mock('./WorkspaceVisualPreparation',()=>({WorkspaceVisualPreparation:({bridge,selectedTargetItemId,currentVisualPath}:any)=><p>{currentVisualPath?'已采用 '+currentVisualPath:bridge?selectedTargetItemId:'错误'}</p>}));
vi.mock('./WorkspaceCaptionsPanel',()=>({WorkspaceCaptionsPanel:({alignmentOnly}:any)=><p>{alignmentOnly?'声学校时':'完整字幕参数'}</p>}));
afterEach(cleanup);
const workspace={id:'w',episodeId:'e',project:{sha256:'h'},clips:[]} as unknown as ProductionWorkspace;
const bridge={connected:true,selectedItemId:'selected',selectedShotId:'S1',inspect:vi.fn(async()=>({document:{activeTimelineId:'t',timelines:[],assets:[]}}))} as unknown as EmbeddedStudioBridge;
it('reuses only the requested candidate tool against the selected native instance',async()=>{
 const props={workspace,command:vi.fn(),onChange:vi.fn(),materials:[],bridge};
 const view=render(<EmbeddedStudioTools {...props} target="visual"/>);
 await waitFor(()=>expect(screen.getByText('selected')).toBeTruthy());expect(screen.queryByText('原生声音候选')).toBeNull();
 await act(async()=>view.rerender(<EmbeddedStudioTools {...props} target="audio"/>));expect(screen.getByText('原生声音候选')).toBeTruthy();
 await act(async()=>view.rerender(<EmbeddedStudioTools {...props} target="captions"/>));expect(screen.getByText('声学校时')).toBeTruthy();expect(screen.queryByText('完整字幕参数')).toBeNull();
});

it('imports the original selected file and prepares a candidate only after an explicit click',async()=>{
 const native={activeTimelineId:'t',timelines:[{id:'t',fps:30,items:[{kind:'text',startFrame:0,durationInFrames:60}]}]};
 const live={...bridge,save:vi.fn(async()=>{}),inspect:vi.fn(async()=>({document:native}))};
 const command=vi.fn(async(name:string)=>name==='importMaterial'?{id:'music',storage_path:'music.mp3'}:workspace),onChange=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({workspace})})));
 await act(async()=>render(<EmbeddedStudioTools workspace={workspace} bridge={live as never} target="visual" command={command} onChange={onChange} importFile={new File(['image'],'selected.png',{type:'image/png'})}/>));
 expect(command).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'导入所选文件'}));
 await waitFor(()=>expect(command).toHaveBeenCalledWith('registerWorkspaceVisualCandidate',expect.objectContaining({materialRevisionId:'music',targetItemId:'selected',usage:'still'})));
 expect(command.mock.calls.map(([name])=>name)).toEqual(['importMaterial','registerWorkspaceVisualCandidate']);expect(onChange).toHaveBeenCalledWith(workspace);
 vi.unstubAllGlobals();
});
it('resolves the adopted native source to its canonical candidate when the binding has no source',async()=>{
 const current={...workspace,clips:[{id:'clip',itemId:'selected',shotId:'S1',text:'镜头',source:null}],visualCandidates:[{id:'chosen',kind:'image',targetItemId:'selected',relativePath:'episodes/e/chosen.png',sha256:'c'.repeat(64),materialRevisionId:'material',status:'adopted'}]} as unknown as ProductionWorkspace;
 const live={...bridge,inspect:vi.fn(async()=>({document:{activeTimelineId:'t',assets:[{id:'candidate-chosen',src:'/media/uploads/cache.png'}],timelines:[{id:'t',items:[{id:'selected',kind:'image',sourceAssetId:'candidate-chosen',src:'/media/uploads/cache.png',sourceContentHash:'c'.repeat(64)}]}]}}))};
 await act(async()=>render(<EmbeddedStudioTools workspace={current} bridge={live as never} target="visual" command={vi.fn()} onChange={vi.fn()}/>));
 expect(screen.getByText('已采用 episodes/e/chosen.png')).toBeTruthy();
});
it('clears the tool busy state when the section unmounts',()=>{
 const onBusyChange=vi.fn();
 const view=render(<EmbeddedStudioTools workspace={workspace} bridge={bridge} target="audio" command={vi.fn()} onChange={()=>{}} onBusyChange={onBusyChange}/>);
 fireEvent.click(screen.getByRole('button',{name:'模拟声音采用'}));expect(onBusyChange).toHaveBeenLastCalledWith(true);view.unmount();expect(onBusyChange).toHaveBeenLastCalledWith(false);
});
