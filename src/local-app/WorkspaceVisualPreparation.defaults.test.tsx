import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import type {ProductionWorkspace} from '../productionWorkspace';

const selection={capability:'image',provider:'openai',adapter:'openai_images',connectionVersionId:'default-version',model:'gpt-image-2'};
const service={id:'defaults-image',capability:'image',provider:'openai',adapter:'openai_images',connectionVersionId:'default-version',connectionName:'图片连接',connectionVersion:1,label:'图片',mode:'generation',models:['gpt-image-2'],executable:true,constraints:{prompt:{maxLength:32000},sizes:['864x1536','1024x1536'],qualities:['auto','high'],counts:[1,2,4],referenceImages:{max:16}}};
const workspace={id:'defaults-workspace',episodeId:'defaults-episode',revision:1,clips:[{id:'a',itemId:'a',shotId:'shot-a',text:'甲'},{id:'b',itemId:'b',shotId:'shot-b',text:'乙'}],visualCandidates:[],visualTasks:[],visualTargets:[],selectedImages:[],visualConfiguration:{imageSelection:selection},stale:false} as unknown as ProductionWorkspace;
const command=vi.fn(async()=>workspace);
function mount(shot:string){return render(<WorkspaceVisualPreparation workspace={workspace} selectedShotId={shot} materials={[]} command={command} onChange={()=>{}}/>);}
async function generateForm(){const button=screen.queryByRole('button',{name:'AI 生成'});if(button)fireEvent.click(button);await waitFor(()=>expect(screen.getByRole('button',{name:'图片连接与模型'}).textContent).toContain('gpt-image-2'));}
afterEach(()=>{cleanup();sessionStorage.clear();localStorage.clear();vi.unstubAllGlobals();command.mockClear();});
it('inherits new episode defaults on a previously visited shot while retaining its own prompt without submitting media',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace,serviceCatalog:{groups:[{capability:'image',services:[service]}]}})));
 const b=mount('shot-b');await generateForm();fireEvent.change(screen.getByRole('textbox',{name:'图片提示词'}),{target:{value:'乙镜头独有提示词'}});fireEvent.click(screen.getByRole('button',{name:'图片规格'}));fireEvent.change(screen.getByRole('combobox',{name:'图片质量'}),{target:{value:'high'}});fireEvent.click(screen.getByRole('button',{name:'关闭图片规格'}));b.unmount();
 const a=mount('shot-a');await generateForm();fireEvent.click(screen.getByRole('button',{name:'生成数量'}));fireEvent.click(screen.getByRole('button',{name:'生成 2 张图片'}));
 const close=screen.queryByRole('button',{name:'关闭生成数量'});if(close)fireEvent.click(close);
 expect(screen.queryByRole('button',{name:'本期图片默认'})).toBeNull();a.unmount();
 mount('shot-b');await generateForm();expect(screen.getByRole('button',{name:'生成数量'}).textContent).toContain('2 张');
 expect(screen.getByRole('textbox',{name:'图片提示词'})).toHaveProperty('value','乙镜头独有提示词');fireEvent.click(screen.getByRole('button',{name:'图片规格'}));expect(screen.getByRole('combobox',{name:'图片质量'})).toHaveProperty('value','high');expect(command).not.toHaveBeenCalled();
});

it('updates another mounted visual instance of the same shot without replacing its explicit parameter override',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace,serviceCatalog:{groups:[{capability:'image',services:[service]}]}})));
 const w={...workspace,clips:workspace.clips.map(c=>({...c,shotId:'shared'}))};
 const a=render(<WorkspaceVisualPreparation workspace={w} selectedTargetItemId="a" materials={[]} command={command} onChange={()=>{}}/>),b=render(<WorkspaceVisualPreparation workspace={w} selectedTargetItemId="b" materials={[]} command={command} onChange={()=>{}}/>);
 for(const view of [a,b])fireEvent.click(within(view.container).getByRole('button',{name:'AI 生成'}));
 await waitFor(()=>expect(within(b.container).getByRole('button',{name:'图片连接与模型'}).textContent).toContain('gpt-image-2'));
 const count=(view:typeof a,value:number)=>{fireEvent.click(within(view.container).getByRole('button',{name:'生成数量'}));fireEvent.click(screen.getByRole('button',{name:`生成 ${value} 张图片`}));fireEvent.click(screen.getByRole('button',{name:'关闭生成数量'}));};
 count(a,4);expect(within(b.container).getByRole('button',{name:'生成数量'}).textContent).toBe('4 张');
 count(b,2);count(a,1);expect(within(b.container).getByRole('button',{name:'生成数量'}).textContent).toBe('2 张');expect(command).not.toHaveBeenCalled();
});
