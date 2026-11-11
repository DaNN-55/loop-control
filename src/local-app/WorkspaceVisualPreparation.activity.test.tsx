import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceVisualTask} from '../workspaceVisualCandidates';

const selection={capability:'image',provider:'openai',adapter:'openai_images',connectionVersionId:'version',model:'gpt-image-2'};
const settings={size:'1536x1024',quality:'high',count:4};
const service={id:'image',capability:'image',provider:'openai',adapter:'openai_images',connectionVersionId:'version',connectionName:'图片连接',connectionVersion:3,label:'图片',mode:'generation',models:['gpt-image-2'],executable:true,constraints:{prompt:{maxLength:32000},sizes:['1536x1024'],qualities:['high'],counts:[4],referenceImages:{max:16}}};
const initial={id:'activity-workspace',episodeId:'activity-episode',revision:1,clips:[{id:'clip',itemId:'target',shotId:'shot',text:'镜头'}],visualCandidates:[],visualTasks:[],visualTargets:[],selectedImages:[],visualConfiguration:{imageSelection:selection},stale:false} as unknown as ProductionWorkspace;
const task={id:'candidate',taskId:'task',targetItemId:'target',kind:'image',status:'running',error:null,provider:'openai',model:'gpt-image-2',createdAt:new Date().toISOString(),submissionOutcome:'started'} as WorkspaceVisualTask;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});

it('shows the actual submission and active task below the composer, removes it on completion, and preserves the request parameters',async()=>{
 let current=initial,change!:(w:ProductionWorkspace)=>void,finish!:(w:ProductionWorkspace)=>void;
 sessionStorage.setItem('loop-visual-draft:activity-workspace:target',JSON.stringify({tab:'image',origin:{image:'generate',video:'material'},settings,imagePrompt:'完整保留原输入',references:[]}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:current,serviceCatalog:{groups:[{capability:'image',services:[service]}]}})));
 const command=vi.fn(()=>new Promise<ProductionWorkspace>(resolve=>{finish=resolve;}));
 function Harness(){const [workspace,setWorkspace]=useState(initial);change=w=>{current=w;setWorkspace(w);};return <WorkspaceVisualPreparation workspace={workspace} materials={[]} command={command} onChange={change}/>;}
 const view=render(<Harness/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成图片'})).toHaveProperty('disabled',false));
 fireEvent.click(screen.getByRole('button',{name:'生成图片'}));
 await waitFor(()=>expect(command).toHaveBeenCalledTimes(1));
 expect(screen.getByText('正在准备生成请求').closest('.workspace-generation-shell')).toBeTruthy();
 expect(command).toHaveBeenCalledWith('requestWorkspaceImageCandidates',expect.objectContaining({selection,settings,prompt:'完整保留原输入',targetItemId:'target',referenceMaterialRevisionIds:[]}));
 await act(async()=>{current={...initial,visualTasks:[task]};finish(current);});
 const bar=view.container.querySelector('.workspace-generation-activity');
 expect(bar?.querySelector('[role=progressbar]')?.getAttribute('aria-valuetext')).toBe('等待供应商返回图片');
 expect(bar?.querySelector('img')?.getAttribute('src')).toBe('/brand/models/openai.svg');
 expect(screen.queryByText('正在准备生成请求')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'查看图片任务详情'}));
 expect(screen.getByRole('dialog',{name:'图片任务详情'}).textContent).toContain('task');
 fireEvent.click(screen.getByRole('button',{name:'关闭图片任务详情'}));
 act(()=>change({...initial,visualTasks:[{...task,status:'completed'}]}));
 expect(view.container.querySelector('.workspace-generation-activity')).toBeNull();
 expect(screen.getByRole('textbox',{name:'图片提示词'})).toHaveProperty('value','完整保留原输入');
 expect(screen.getByRole('button',{name:'图片规格'}).textContent).toContain('1536×1024');
});

it('keeps failed and unknown results in the existing diagnostic and recovery presentation',async()=>{
 const failed={...task,status:'failed',error:'供应商拒绝本次请求',submissionOutcome:'rejected' as const};
 sessionStorage.setItem('loop-visual-draft:activity-workspace:target',JSON.stringify({tab:'image',origin:{image:'generate',video:'material'},settings,imagePrompt:'画面'}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:{...initial,visualTasks:[failed]},serviceCatalog:{groups:[{capability:'image',services:[service]}]}})));
 const view=render(<WorkspaceVisualPreparation workspace={{...initial,visualTasks:[failed]}} materials={[]} command={vi.fn()} onChange={()=>{}}/>);
 expect(view.container.querySelector('.workspace-generation-activity')).toBeNull();
 expect(screen.getByRole('alert').textContent).toContain('供应商拒绝本次请求');
 expect(screen.getByRole('button',{name:'查看图片任务详情'})).toBeTruthy();
 await waitFor(()=>expect(screen.getByRole('button',{name:'重新生成图片'})).toHaveProperty('disabled',false));
 view.rerender(<WorkspaceVisualPreparation workspace={{...initial,visualTasks:[{...failed,submissionUnknown:true,submissionOutcome:'started'}]}} materials={[]} command={vi.fn()} onChange={()=>{}}/>);
 expect(screen.getByRole('button',{name:'重新生成'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'刷新核对结果'})).toBeTruthy();
 expect(view.container.querySelector('.workspace-generation-activity')).toBeNull();
});
