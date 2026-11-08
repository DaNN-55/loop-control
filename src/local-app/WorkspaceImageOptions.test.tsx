import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {emptyImageBrief,imageSizes} from '../imageGeneration';
import type {ProductionWorkspace} from '../productionWorkspace';
const selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:'connection'};
const w={id:'w',episodeId:'e',revision:3,stale:false,clips:[{itemId:'item',shotId:'S1',source:null}],visualTargets:[{targetItemId:'item',width:1080,height:1920}],visualConfiguration:{imageSelection:selection},visualCandidates:[],visualTasks:[]} as unknown as ProductionWorkspace;
const catalog={groups:[{capability:'image',services:[{id:'service',connectionVersionId:'connection',provider:'openai',adapter:'openai_images',models:['gpt-image-2'],executable:true,constraints:{sizes:imageSizes,qualities:['auto','low','medium','high'],counts:[1,2,4],referenceImages:{max:16}}}]}]};
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('submits pixel resolution, ordered reference instructions and composition in one frozen generation request',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?{serviceCatalog:catalog}:{workspace:w})));
 sessionStorage.setItem('loop-visual-draft:w:item',JSON.stringify({
  tab:'image',settings:{size:'864x1536',quality:'auto',count:1},
  imageBrief:{...emptyImageBrief,framing:'close',crop:'protect'},
 }));
 const command=vi.fn(async()=>w);render(<WorkspaceVisualPreparation workspace={w} command={command} onChange={()=>{}} materials={[{id:'ref',material_type:'image',source_path:'产品.png'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await waitFor(()=>expect(screen.getByRole('button',{name:'图片连接与模型'}).textContent).toContain('gpt-image-2'));fireEvent.click(screen.getByRole('button',{name:'构图与字幕留白'}));
 expect((screen.getByLabelText('图片主体构图') as HTMLSelectElement).selectedOptions[0].textContent).toBe('主体特写，四周留余量');
 expect(screen.queryByLabelText('图片后续裁切')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'关闭构图与字幕留白'}));fireEvent.click(screen.getByRole('button',{name:'图片规格'}));expect(screen.getByRole('button',{name:'9:16'}).getAttribute('aria-pressed')).toBe('true');fireEvent.click(screen.getByRole('button',{name:'高分辨率'}));expect(screen.getByRole('textbox',{name:'图片高度'})).toHaveProperty('value','2048');fireEvent.click(screen.getByRole('button',{name:'关闭图片规格'}));
 fireEvent.click(screen.getByRole('button',{name:'添加参考图'}));fireEvent.click(screen.getByLabelText('参考图 产品.png'));fireEvent.click(screen.getByRole('button',{name:'关闭参考图选择'}));
 fireEvent.click(screen.getByRole('button',{name:'编辑参考图 1 用途'}));fireEvent.change(screen.getByLabelText('参考图 1 需要保留'),{target:{value:'产品图案'}});fireEvent.change(screen.getByLabelText('参考图 1 允许改变'),{target:{value:'背景'}});fireEvent.click(screen.getByRole('button',{name:'构图与字幕留白'}));fireEvent.change(screen.getByLabelText('图片字幕留白'),{target:{value:'bottom'}});fireEvent.change(screen.getByLabelText('图片主体构图'),{target:{value:'full-with-margin'}});fireEvent.click(screen.getByRole('button',{name:'关闭构图与字幕留白'}));fireEvent.change(screen.getByLabelText('图片提示词'),{target:{value:'客厅产品摄影'}});
 fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceImageCandidates',expect.objectContaining({settings:{size:'1152x2048',quality:'auto',count:1},referenceMaterialRevisionIds:['ref'],imageBrief:{references:[{materialRevisionId:'ref',purpose:'subject',preserve:'产品图案',change:'背景'}],framing:'full',captionSpace:'bottom',crop:'protect'}})));
});
it('prioritizes first-frame selection and keeps explicit adoption in the image action menu',()=>{
 const candidate={id:'candidate',kind:'image',status:'available',targetItemId:'item',relativePath:'photo.png',sha256:'sha',materialRevisionId:'ref',durationSeconds:3,currentDurationSeconds:3};
 const command=vi.fn();render(<WorkspaceVisualPreparation workspace={{...w,visualCandidates:[candidate as any]}} command={command} onChange={()=>{}} materials={[{id:'ref',material_type:'image',source_path:'产品.png',storage_path:'photo.png'}]}/>);fireEvent.click(screen.getByRole('button',{name:'预览图片候选 01'}));fireEvent.click(screen.getByText('更多操作',{selector:'summary'}));const adopt=screen.getByRole('button',{name:'采用到当前镜头'}),first=screen.getByRole('button',{name:'用作视频首帧'});expect(first.closest('details')).toBeNull();expect(adopt.closest('details')).toBeTruthy();expect(screen.getByText('用作镜头画面，保持时长不变').id).toBe(adopt.getAttribute('aria-describedby'));expect(screen.queryByText('使用设置')).toBeNull();fireEvent.click(first);expect(command).not.toHaveBeenCalled();expect(screen.getByAltText('已选视频首帧').getAttribute('src')).toContain('photo.png');expect(screen.getByText('已选定视频首帧，尚未提交生成。')).toBeTruthy();
});

it.each(['gpt-image-2.5-flare','gpt-image-2.6-sunburst','gpt-image-2.6-flare'])('uses enhanced quality for %s and preserves incompatible drafts when switching back',async model=>{
 const service=catalog.groups[0].services[0];
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w,serviceCatalog:{groups:[{capability:'image',services:[{...service,models:['gpt-image-2',model],modelConstraints:{[model]:{qualities:['auto','low','medium','high','xhigh','max']}}}]}]}})));
 const command=vi.fn();render(<WorkspaceVisualPreparation workspace={w} materials={[]} command={command} onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await waitFor(()=>expect(screen.getByRole('button',{name:'图片连接与模型'}).textContent).toContain('gpt-image-2'));
 expect(screen.queryByRole('heading',{name:'画面候选'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'图片连接与模型'}));fireEvent.click(screen.getByRole('menuitemradio',{name:new RegExp('^'+model)}));
 fireEvent.change(screen.getByLabelText('图片质量'),{target:{value:'max'}});expect(screen.getByRole('option',{name:'超高'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'关闭图片规格'}));fireEvent.click(screen.getByRole('button',{name:'图片连接与模型'}));fireEvent.click(screen.getByRole('menuitemradio',{name:/^gpt-image-2(?:\s|$)/}));
 fireEvent.click(screen.getByRole('button',{name:'关闭图片规格'}));expect(screen.getByRole('list',{name:'图片设置不兼容'}).textContent).toContain('质量：最高');fireEvent.click(screen.getByRole('button',{name:'图片规格'}));expect(screen.getByLabelText('图片质量')).toHaveProperty('value','max');expect(command).not.toHaveBeenCalled();
});
