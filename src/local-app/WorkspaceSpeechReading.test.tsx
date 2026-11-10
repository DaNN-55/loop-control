import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceNarrationPanel} from './WorkspaceNarrationPanel';
import {registeredAdapters} from '../worker/registeredAdapters';
import {WorkspaceAudioPreparation} from './WorkspaceAudioPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';

const workspace={id:'workspace',episodeId:'episode',revision:3,stale:false,project:{sha256:'saved'},clips:[
 {id:'clip-1',itemId:'visual-1',shotId:'S1',text:'第一镜',source:null},
 {id:'clip-2',itemId:'visual-2',shotId:'S2',text:'第二镜',source:null},
],candidates:[],narration:['S1','S2'].map((shotId,i)=>({shotId,clipId:`clip-${i+1}`,text:`已保存${shotId}`,inputFingerprint:shotId,status:'running',taskId:`speech-${shotId}`})),audio:{mix:{voices:[],sounds:[]},preparations:[{id:'effect',kind:'sfx',shotId:'S1',description:'音效任务',taskId:'sound',status:'running',anchor:'shot',offsetSeconds:0,durationSeconds:1}]}} as unknown as ProductionWorkspace;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
afterEach(()=>{cleanup();sessionStorage.clear();vi.useRealTimers();vi.unstubAllGlobals();});
function Host({command,changed=()=>{},target='S1',bridge}:{command:(name:string,data:unknown)=>Promise<unknown>;changed?:(w:ProductionWorkspace)=>void;target?:string;bridge?:EmbeddedStudioBridge}){
 const [w,set]=useState(workspace);
 const onChange=(value:ProductionWorkspace)=>{set(value);changed(value);};
 return <><output data-testid="revision">{w.revision}</output><output data-testid="status">{w.narration?.[0].status}</output>
 <button onClick={()=>set({...w,revision:9})}>external save</button>
 <WorkspaceAudioPreparation workspace={w} command={command} onChange={onChange} selectedShotId={target} materials={[{id:'manual',material_type:'audio',source_path:'click.mp3',material_purpose:'background_music'}]} bridge={bridge}/></>;
}
function setupFetch(read:()=>Promise<Response>){vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/api/local/connections'?Promise.resolve(Response.json({serviceCatalog:{groups:[]}})):read()));}
function setPurpose(value:string){fireEvent.change(screen.queryByLabelText('音效意图或检索词')??screen.getByLabelText('英文检索词'),{target:{value}});}
function purpose(){return ((screen.queryByLabelText('音效意图或检索词')??screen.getByLabelText('英文检索词')) as HTMLTextAreaElement).value;}
function prepareSound(){fireEvent.drop(screen.getByRole('group',{name:'音频输入'}),{dataTransfer:{types:['application/x-loop-workspace-material'],getData:()=> 'manual',files:[]}});}

it('ignores a slow sound refresh after a same-revision command response',async()=>{
 vi.useFakeTimers();const sound=deferred<ProductionWorkspace>();
 const next={...workspace,narration:workspace.narration!.map(n=>({...n,status:'completed' as const}))};
 setupFetch(async()=>Response.json({workspace:next}));
 const changed=vi.fn(),command=vi.fn((name:string)=>name==='refreshWorkspaceAudio'?sound.promise:Promise.resolve(next));
 render(<Host command={command} changed={changed}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(9000);});
 expect(command.mock.calls.filter(([name])=>name==='refreshWorkspaceAudio')).toHaveLength(1);
 prepareSound();await act(async()=>{});expect(screen.getByTestId('status').textContent).toBe('completed');
 const before=changed.mock.calls.length;await act(async()=>{sound.resolve(workspace);});
 expect(changed).toHaveBeenCalledTimes(before);expect(screen.getByTestId('revision').textContent).toBe('3');
 expect(screen.getByTestId('status').textContent).toBe('completed');
});
it('ignores a sound reply after switching shots or unmounting',async()=>{
 vi.useFakeTimers();const sound=deferred<ProductionWorkspace>();setupFetch(async()=>Response.json({workspace}));
 const command=vi.fn(()=>sound.promise),changed=vi.fn(),props={command,changed},view=render(<Host {...props}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});view.rerender(<Host {...props} target="S2"/>);
 await act(async()=>{sound.resolve({...workspace,revision:8});});
 expect(changed).not.toHaveBeenCalled();expect(screen.getByTestId('revision').textContent).toBe('3');view.unmount();
});
it('keeps sound drafts through refresh, shot switches and reopening',async()=>{
 vi.useFakeTimers();setupFetch(async()=>Response.json({workspace:{...workspace,revision:4}}));
 const command=vi.fn(async(_name:string)=>({...workspace,revision:4}));
 const props={workspace,command,onChange:vi.fn()},element=(target='S1')=><WorkspaceAudioPreparation {...props} selectedShotId={target}/>;
 const view=render(element());
 fireEvent.change(screen.getByLabelText('英文检索词'),{target:{value:'ambient footsteps'}});
 fireEvent.click(screen.getByRole('button',{name:'音效'}));setPurpose('未提交的草稿');
 await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({revision:4}));
 view.rerender(element('S2'));view.rerender(element());expect(purpose()).toBe('未提交的草稿');view.unmount();render(element());expect(purpose()).toBe('未提交的草稿');
 expect(screen.getByRole('button',{name:'音效'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'整期配乐'}));expect(screen.getByLabelText('英文检索词')).toHaveProperty('value','ambient footsteps');
 expect(command.mock.calls.every(call=>call[0]==='refreshWorkspaceAudio')).toBe(true);
});
it('does not submit audio after a slow saved-workspace read belongs to a different shot',async()=>{
 const slow=deferred<Response>();setupFetch(()=>slow.promise);const command=vi.fn(async()=>workspace),changed=vi.fn();
 const bridge={connected:true,save:vi.fn(async()=>{}),inspect:vi.fn(async()=>({document:{assets:[],timelines:[]}}))} as unknown as EmbeddedStudioBridge;
 const view=render(<Host command={command} changed={changed} bridge={bridge}/>);prepareSound();await act(async()=>{});
 view.rerender(<Host command={command} changed={changed} bridge={bridge} target="S2"/>);
 await act(async()=>{slow.resolve(Response.json({workspace}));});
 expect(command).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();
});

it('shows an audio version conflict without retrying or clearing the form',async()=>{
 setupFetch(async()=>Response.json({workspace}));const command=vi.fn(async()=>{throw Error('工程版本已变化，请重新打开当前工作版本。');});
 render(<Host command={command}/>);setPurpose('拒绝后保留');prepareSound();await act(async()=>{});
 expect(screen.getByRole('alert').textContent).toContain('工程版本已变化');expect(command).toHaveBeenCalledTimes(1);expect(purpose()).toBe('拒绝后保留');fireEvent.click(screen.getByRole('button',{name:'保存本期配乐配置'}));await act(async()=>{});expect(command).toHaveBeenLastCalledWith('saveWorkspaceMusicSettings',expect.objectContaining({settings:expect.objectContaining({query:'拒绝后保留',materialRevisionId:'manual'})}));
});

it('keeps an external save when an older sound reply returns',async()=>{
 vi.useFakeTimers();const sound=deferred<ProductionWorkspace>();setupFetch(async()=>Response.json({workspace}));const changed=vi.fn();
 render(<Host command={vi.fn(()=>sound.promise)} changed={changed}/>);await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
 fireEvent.click(screen.getByRole('button',{name:'external save'}));await act(async()=>{sound.resolve(workspace);});
 expect(screen.getByTestId('revision').textContent).toBe('9');expect(changed).not.toHaveBeenCalled();
});
it('ignores a sound reply after unmount',async()=>{
 vi.useFakeTimers();const sound=deferred<ProductionWorkspace>();setupFetch(async()=>Response.json({workspace}));const changed=vi.fn(),view=render(<Host command={vi.fn(()=>sound.promise)} changed={changed}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});view.unmount();await act(async()=>{sound.resolve({...workspace,revision:8});});expect(changed).not.toHaveBeenCalled();
});
it('keeps narration preparation text after refreshed status and reopening',async()=>{
 const choice=registeredAdapters.productionChoices().find(c=>c.capability==='speech')!,selection={capability:'speech' as const,provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:'voice'};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'speech',services:[{...choice,id:'voice',connectionVersionId:'voice',executable:true}]}]}})));
 const settings={selection,voice:'zh_female_vv_uranus_bigtts',speakingRate:1,languageCode:'zh-CN'},idle={...workspace,narration:workspace.narration!.map(n=>({...n,...settings,mode:'tts' as const,defaults:settings,status:'pending' as const}))},command=vi.fn();
 const props={episodeId:workspace.episodeId,pending:false,command,onChanged:vi.fn()},element=(w:ProductionWorkspace,target='S1')=><WorkspaceNarrationPanel {...props} workspace={w} selectedShotId={target}/>;
 const view=render(element(idle));await act(async()=>{});
 fireEvent.change(screen.getByRole('textbox',{name:'口播文案'}),{target:{value:'刷新后保留的口播改稿'}});
 const refreshed={...idle,revision:4,narration:idle.narration.map(n=>({...n,status:'completed' as const}))};
 view.rerender(element(refreshed));view.rerender(element(refreshed,'S2'));view.rerender(element(refreshed));view.unmount();render(element(refreshed));await act(async()=>{});
 expect((screen.getByRole('textbox',{name:'口播文案'}) as HTMLTextAreaElement).value).toBe('刷新后保留的口播改稿');expect(command).not.toHaveBeenCalled();
});
