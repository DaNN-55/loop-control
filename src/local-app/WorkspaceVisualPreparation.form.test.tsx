import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {WorkspaceMaterialSelectionProvider,workspaceMaterialDragType} from './WorkspaceMaterialDrop';
import type {ProductionWorkspace} from '../productionWorkspace';

const selection={capability:'image',provider:'openai',adapter:'openai_images',connectionVersionId:'version',model:'gpt-image-2'};
const service={id:'image-service',capability:'image',provider:'openai',adapter:'openai_images',connectionVersionId:'version',connectionName:'工作室图片连接',connectionVersion:3,label:'图片',mode:'generation',models:['gpt-image-2','long-image-model-name-for-a-narrow-generation-panel-20261102'],executable:true,constraints:{prompt:{maxLength:32000},sizes:['1024x1536'],qualities:['auto'],counts:[1],referenceImages:{max:16}}};
const workspace={id:'form-workspace',episodeId:'form-episode',revision:1,clips:[{id:'clip',itemId:'target',shotId:'shot',text:'镜头'}],visualCandidates:[],visualTasks:[],visualTargets:[],selectedImages:[],visualConfiguration:{imageSelection:selection},stale:false} as unknown as ProductionWorkspace;
function setup(draft:Record<string,unknown>={}){
 sessionStorage.setItem('loop-visual-draft:form-workspace:target',JSON.stringify({tab:'image',origin:{image:'generate',video:'material'},settings:{size:'1024x1536',quality:'auto',count:1},...draft}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace,serviceCatalog:{groups:[{capability:'image',services:[service]}]}})));
 const command=vi.fn(async()=>workspace),materials=Array.from({length:16},(_,i)=>({id:`ref-${i}`,material_type:'image',source_path:`图片-${i+1}.png`,storage_path:`media/image-${i}.png`}));
 return {command,materials,view:render(<WorkspaceVisualPreparation workspace={workspace} materials={materials} command={command} onChange={()=>{}}/>)};
}
async function modelReady(){await waitFor(()=>expect(screen.getByRole('button',{name:'图片连接与模型'}).textContent).toContain('gpt-image-2'));}
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('提示词接近实际输入上限时提示计数，完整保留超限输入并阻止提交',async()=>{
 const {command}=setup();await modelReady();
 const prompt=screen.getByRole('textbox',{name:'图片提示词'});
 fireEvent.change(prompt,{target:{value:'山'.repeat(1080)}});
 expect(screen.getByText('1,080 / 1,200 字符')).toBeTruthy();
 fireEvent.change(prompt,{target:{value:'山'.repeat(1201)}});
 expect(prompt).toHaveProperty('value','山'.repeat(1201));
 expect(screen.getByRole('alert').textContent).toContain('图片提示词超出 1 个字符');
 expect(screen.getByRole('button',{name:'生成图片'})).toHaveProperty('disabled',true);
 expect(command).not.toHaveBeenCalled();
});
it('模型选项平铺展示并保留连接提示，不兼容反馈定位具体已注册参数且不改草稿',async()=>{
 const {command}=setup({settings:{size:'1536x1024',quality:'high',count:4},imagePrompt:'画面'});
 await modelReady();
 fireEvent.click(screen.getByRole('button',{name:'图片连接与模型'}));
 expect(screen.queryByRole('group',{name:/OpenAI/})).toBeNull();
 expect(screen.getByRole('menuitemradio',{name:/^gpt-image-2/}).querySelector('strong')?.title).toContain('工作室图片连接');
 expect(screen.getByRole('menuitemradio',{name:/^gpt-image-2/}).textContent).toBe('gpt-image-2');
 fireEvent.click(screen.getByRole('button',{name:'关闭模型选择'}));
 const problems=screen.getByRole('list',{name:'图片设置不兼容'});
 expect(problems.textContent).toContain('实际像素：1536 × 1024；当前模型支持 1024 × 1536');
 expect(problems.textContent).toContain('质量：高；当前模型支持 自动');
 expect(problems.textContent).toContain('数量：4 张；当前模型支持 1 张');
 fireEvent.click(screen.getByRole('button',{name:'生成数量'}));
 expect(screen.getByRole('button',{name:'生成 4 张图片'}).getAttribute('aria-pressed')).toBe('true');
 expect(screen.getByRole('button',{name:'生成 4 张图片'})).toHaveProperty('disabled',true);
 expect(command).not.toHaveBeenCalled();
});
it('十六张参考图默认只显示缩略摘要，逐图展开并在重开后保留用途与完整选项',async()=>{
 const refs=Array.from({length:16},(_,i)=>`ref-${i}`),fixture=setup({references:refs});await modelReady();
 expect(screen.queryByRole('textbox',{name:'参考图 1 需要保留'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'编辑参考图 16 用途'}));
 fireEvent.change(screen.getByRole('combobox',{name:'参考图 16 用途'}),{target:{value:'style'}});
 fireEvent.change(screen.getByRole('textbox',{name:'参考图 16 需要保留'}),{target:{value:'保留细密纹理'}});
 fireEvent.change(screen.getByRole('textbox',{name:'参考图 16 允许改变'}),{target:{value:'改变背景'}});
 expect(screen.getByRole('button',{name:'编辑参考图 16 用途'}).textContent).toContain('风格');
 expect(screen.getAllByRole('button',{name:/放大参考图/})).toHaveLength(16);
 fixture.view.unmount();render(<WorkspaceVisualPreparation workspace={workspace} materials={fixture.materials} command={fixture.command} onChange={()=>{}}/>);
 await modelReady();fireEvent.click(screen.getByRole('button',{name:'编辑参考图 16 用途'}));
 expect(screen.getByRole('textbox',{name:'参考图 16 需要保留'})).toHaveProperty('value','保留细密纹理');
 expect(screen.getByRole('textbox',{name:'参考图 16 允许改变'})).toHaveProperty('value','改变背景');
 expect(screen.getAllByRole('button',{name:/放大参考图/})).toHaveLength(16);expect(fixture.command).not.toHaveBeenCalled();
});

it('窄窗中的长模型名可完整核对，不自动提交',async()=>{
 const {command}=setup();await modelReady();
 fireEvent.click(screen.getByRole('button',{name:'图片连接与模型'}));
 fireEvent.change(screen.getByRole('searchbox',{name:'筛选图片模型'}),{target:{value:'long-image'}});
 await userEvent.click(screen.getByRole('menuitemradio',{name:/^long-image-model-name/}));
 expect(await screen.findByRole('dialog',{name:'图片规格'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'关闭图片规格'}));
 expect(screen.getByRole('button',{name:'图片连接与模型'}).textContent).toContain('long-image-model-name-for-a-narrow-generation-panel-20261102');
 expect(command).not.toHaveBeenCalled();
});
it('视频负面提示词也显示真实限制，完整保留超限内容',()=>{
 setup({tab:'video',origin:{image:'material',video:'generate'},videoSelection:{capability:'video',provider:'bailian',adapter:'wan_video',connectionVersionId:'video-version',model:'wan2.6-i2v-flash'}});
 fireEvent.click(screen.getByRole('button',{name:'高级视频设置'}));
 fireEvent.change(screen.getByRole('textbox',{name:'视频负面提示词'}),{target:{value:'虚'.repeat(501)}});
 expect(screen.getByRole('textbox',{name:'视频负面提示词'})).toHaveProperty('value','虚'.repeat(501));
 expect(screen.getByText('501 / 500 字符')).toBeTruthy();
 expect(screen.getByText('负面提示词超出 1 个字符，请精简后提交。')).toBeTruthy();
});

it('rejects a seventeenth dragged reference without replacing the current references',async()=>{
 const refs=Array.from({length:16},(_,i)=>`ref-${i}`),materials=Array.from({length:17},(_,i)=>({id:`ref-${i}`,material_type:'image',source_path:`image-${i}.png`,storage_path:`image-${i}.png`}));
 sessionStorage.setItem('loop-visual-draft:form-workspace:target',JSON.stringify({tab:'image',origin:{image:'generate',video:'material'},settings:{size:'1024x1536',quality:'auto',count:1},references:refs}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'image',services:[service]}]}})));const command=vi.fn();
 render(<WorkspaceMaterialSelectionProvider materials={materials}><WorkspaceVisualPreparation workspace={workspace} materials={materials} command={command} onChange={()=>{}}/></WorkspaceMaterialSelectionProvider>);await modelReady();
 fireEvent.drop(screen.getByLabelText('图片生成输入框'),{dataTransfer:{types:[workspaceMaterialDragType],files:[],getData:()=> 'ref-16'}});
 expect(screen.getByRole('alert').textContent).toContain('最多使用 16 张参考图');expect(screen.getAllByRole('button',{name:/放大参考图/})).toHaveLength(16);expect(command).not.toHaveBeenCalled();
});

it('空提示词不重复显示填写提示，仍阻止生成并保留超限错误',async()=>{
 const {command}=setup();await modelReady();
 expect(screen.queryByText('请填写提示词。')).toBeNull();
 expect(screen.getByRole('button',{name:'生成图片'})).toHaveProperty('disabled',true);
 fireEvent.change(screen.getByRole('textbox',{name:'图片提示词'}),{target:{value:'山'.repeat(1201)}});
 expect(screen.getByRole('alert').textContent).toContain('图片提示词超出 1 个字符');
 expect(screen.getByRole('button',{name:'生成图片'})).toHaveProperty('disabled',true);
 expect(command).not.toHaveBeenCalled();
});
