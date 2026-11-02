import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
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
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('提示词接近实际输入上限时提示计数，完整保留超限输入并阻止提交',async()=>{
 const {command}=setup();await screen.findByRole('option',{name:/gpt-image-2/});
 const prompt=screen.getByRole('textbox',{name:'图片提示词'});
 fireEvent.change(prompt,{target:{value:'山'.repeat(1080)}});
 expect(screen.getByText('1,080 / 1,200 字符')).toBeTruthy();
 fireEvent.change(prompt,{target:{value:'山'.repeat(1201)}});
 expect(prompt).toHaveProperty('value','山'.repeat(1201));
 expect(screen.getByRole('alert').textContent).toContain('图片提示词超出 1 个字符');
 expect(screen.getByRole('button',{name:'生成图片'})).toHaveProperty('disabled',true);
 expect(command).not.toHaveBeenCalled();
});
it('模型优先并按连接分组，不兼容反馈定位具体已注册参数且不改草稿',async()=>{
 const {command}=setup({settings:{size:'1536x1024',quality:'high',count:4},imagePrompt:'画面'});
 const model=await screen.findByRole('option',{name:'gpt-image-2'});
 expect(model.parentElement?.tagName).toBe('OPTGROUP');
 expect(model.parentElement?.getAttribute('label')).toContain('工作室图片连接');
 const problems=screen.getByRole('list',{name:'图片设置不兼容'});
 expect(problems.textContent).toContain('实际像素：1536 × 1024；当前模型支持 1024 × 1536');
 expect(problems.textContent).toContain('质量：高；当前模型支持 自动');
 expect(problems.textContent).toContain('数量：4 张；当前模型支持 1 张');
 expect(screen.getByRole('combobox',{name:'生成图片数量'})).toHaveProperty('value','4');
 expect(command).not.toHaveBeenCalled();
});
it('十六张参考图默认只显示缩略摘要，逐图展开并在重开后保留用途与完整选项',async()=>{
 const refs=Array.from({length:16},(_,i)=>`ref-${i}`),fixture=setup({references:refs});await screen.findByRole('option',{name:'gpt-image-2'});
 expect(screen.queryByRole('textbox',{name:'参考图 1 需要保留'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'编辑参考图 16 用途'}));
 fireEvent.change(screen.getByRole('combobox',{name:'参考图 16 用途'}),{target:{value:'style'}});
 fireEvent.change(screen.getByRole('textbox',{name:'参考图 16 需要保留'}),{target:{value:'保留细密纹理'}});
 fireEvent.change(screen.getByRole('textbox',{name:'参考图 16 允许改变'}),{target:{value:'改变背景'}});
 expect(screen.getByRole('button',{name:'编辑参考图 16 用途'}).textContent).toContain('风格');
 expect(screen.getAllByRole('button',{name:/放大参考图/})).toHaveLength(16);
 fixture.view.unmount();render(<WorkspaceVisualPreparation workspace={workspace} materials={fixture.materials} command={fixture.command} onChange={()=>{}}/>);
 await screen.findByRole('option',{name:'gpt-image-2'});fireEvent.click(screen.getByRole('button',{name:'编辑参考图 16 用途'}));
 expect(screen.getByRole('textbox',{name:'参考图 16 需要保留'})).toHaveProperty('value','保留细密纹理');
 expect(screen.getByRole('textbox',{name:'参考图 16 允许改变'})).toHaveProperty('value','改变背景');
 expect(screen.getAllByRole('button',{name:/放大参考图/})).toHaveLength(16);expect(fixture.command).not.toHaveBeenCalled();
});

it('窄窗中的长模型名可完整核对，不自动提交',async()=>{
 const {command}=setup();await screen.findByRole('option',{name:'gpt-image-2'});
 fireEvent.change(screen.getByRole('combobox',{name:'图片连接与模型'}),{target:{value:'image-service:long-image-model-name-for-a-narrow-generation-panel-20261102'}});
 expect(screen.getByText('long-image-model-name-for-a-narrow-generation-panel-20261102',{selector:'.workspace-selected-model'})).toBeTruthy();
 expect(command).not.toHaveBeenCalled();
});
it('视频负面提示词也显示真实限制，完整保留超限内容',()=>{
 setup({tab:'video',origin:{image:'material',video:'generate'},videoSelection:{capability:'video',provider:'bailian',adapter:'wan_video',connectionVersionId:'video-version',model:'wan2.6-i2v-flash'}});
 fireEvent.click(screen.getByText('高级生成设置'));
 fireEvent.change(screen.getByRole('textbox',{name:'视频负面提示词'}),{target:{value:'虚'.repeat(501)}});
 expect(screen.getByRole('textbox',{name:'视频负面提示词'})).toHaveProperty('value','虚'.repeat(501));
 expect(screen.getByText('501 / 500 字符')).toBeTruthy();
 expect(screen.getByText('负面提示词超出 1 个字符，请精简后提交。')).toBeTruthy();
});
