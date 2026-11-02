import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {imageSizes} from '../imageGeneration';
import type {ProductionWorkspace} from '../productionWorkspace';
const selection={capability:'image',provider:'openai',adapter:'openai_images',model:'gpt-image-2',connectionVersionId:'connection'};
const w={id:'w',episodeId:'e',revision:3,stale:false,clips:[{itemId:'item',shotId:'S1',source:null}],visualTargets:[{targetItemId:'item',width:1080,height:1920}],visualConfiguration:{imageSelection:selection},visualCandidates:[],visualTasks:[]} as unknown as ProductionWorkspace;
const catalog={groups:[{capability:'image',services:[{id:'service',connectionVersionId:'connection',provider:'openai',adapter:'openai_images',models:['gpt-image-2'],executable:true,constraints:{sizes:imageSizes,qualities:['auto','low','medium','high'],counts:[1,2,4],referenceImages:{max:16}}}]}]};
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('submits pixel resolution, ordered reference instructions and composition in one frozen generation request',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/local/connections'?{serviceCatalog:catalog}:{workspace:w})));
 const command=vi.fn(async()=>w);render(<WorkspaceVisualPreparation workspace={w} command={command} onChange={()=>{}} materials={[{id:'ref',material_type:'image',source_path:'产品.png'}]}/>);
 fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 expect((screen.getByLabelText('图片画面比例') as HTMLSelectElement).value).toBe('9:16');fireEvent.change(screen.getByLabelText('图片实际像素'),{target:{value:'1152x2048'}});
 fireEvent.click(screen.getByRole('button',{name:'添加参考图'}));fireEvent.click(screen.getByLabelText('参考图 产品.png'));fireEvent.click(screen.getByRole('button',{name:'关闭参考图选择'}));
 fireEvent.click(screen.getByRole('button',{name:'编辑参考图 1 用途'}));fireEvent.change(screen.getByLabelText('参考图 1 需要保留'),{target:{value:'产品图案'}});fireEvent.change(screen.getByLabelText('参考图 1 允许改变'),{target:{value:'背景'}});fireEvent.change(screen.getByLabelText('图片字幕留白'),{target:{value:'bottom'}});fireEvent.change(screen.getByLabelText('图片主体构图'),{target:{value:'full'}});fireEvent.change(screen.getByLabelText('图片后续裁切'),{target:{value:'protect'}});fireEvent.change(screen.getByLabelText('图片提示词'),{target:{value:'客厅产品摄影'}});
 fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await waitFor(()=>expect(command).toHaveBeenCalledWith('requestWorkspaceImageCandidates',expect.objectContaining({settings:{size:'1152x2048',quality:'auto',count:1},referenceMaterialRevisionIds:['ref'],imageBrief:{references:[{materialRevisionId:'ref',purpose:'subject',preserve:'产品图案',change:'背景'}],framing:'full',captionSpace:'bottom',crop:'protect'}})));
});
it('places first-frame and adoption side by side and selecting a first frame does not write or generate',()=>{
 const candidate={id:'candidate',kind:'image',status:'available',targetItemId:'item',relativePath:'photo.png',sha256:'sha',materialRevisionId:'ref',durationSeconds:3,currentDurationSeconds:3};
 const command=vi.fn();render(<WorkspaceVisualPreparation workspace={{...w,visualCandidates:[candidate as any]}} command={command} onChange={()=>{}} materials={[{id:'ref',material_type:'image',source_path:'产品.png'}]}/>);fireEvent.click(screen.getByRole('button',{name:'预览图片候选 01'}));const adopt=screen.getByRole('button',{name:'采用此图片'}),first=screen.getByRole('button',{name:'用作视频首帧'});expect(first.parentElement).toBe(adopt.parentElement);expect(first.closest('details')).toBeNull();fireEvent.click(first);expect(command).not.toHaveBeenCalled();expect((screen.getByLabelText('画面首帧图片') as HTMLSelectElement).value).toBe('ref');expect(screen.getByText('已选定视频首帧，尚未提交生成。')).toBeTruthy();
});
