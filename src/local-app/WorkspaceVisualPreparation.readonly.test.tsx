import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(()=>{cleanup();sessionStorage.clear();vi.restoreAllMocks();});
const workspace={id:'w',episodeId:'e',clips:[{id:'c',itemId:'item',shotId:'S1',text:'镜头',source:null}],visualCandidates:[{id:'image',kind:'image',targetItemId:'item',shotId:'S1',status:'adopted',relativePath:'frozen.png',sha256:'hash',usage:'still',durationSeconds:3,width:1080,height:1920,generation:{selection:{provider:'openai',adapter:'images',model:'frozen-model',connectionVersionId:'v1'},connectionName:'原图片连接',prompt:'实际提交的图片提示词',imageSettings:{size:'1024x1536',count:2,quality:'high'},referenceMaterialRevisionIds:['ref-original']}}]} as unknown as ProductionWorkspace;
it('shows frozen generated and adopted facts without mounting editable drafts or sending commands',()=>{
 const command=vi.fn(),storage=vi.spyOn(Storage.prototype,'setItem'),fetch=vi.spyOn(globalThis,'fetch');
 sessionStorage.setItem('loop-image-default:w',JSON.stringify({imageSelection:{model:'new-default'}}));storage.mockClear();
 render(<WorkspaceVisualPreparation workspace={workspace} readOnly command={command} onChange={vi.fn()} materials={[]} currentVisualPath="frozen.png" currentVisualKind="image"/>);
 expect(screen.getByRole('region',{name:'画面制作记录'})).toBeTruthy();expect(screen.getByText('实际提交的图片提示词')).toBeTruthy();expect(screen.getByText('frozen-model')).toBeTruthy();expect(screen.getByText('当前采用 · 图片')).toBeTruthy();expect(screen.queryByText('new-default')).toBeNull();expect(document.querySelector('input,textarea,select')).toBeNull();expect(storage).not.toHaveBeenCalled();expect(command).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('keeps video request parameters distinct from image settings and identifies selected backup separately',()=>{
 const image=workspace.visualCandidates![0],video={...image,id:'video',kind:'video' as const,status:'available' as const,relativePath:'frozen.mp4',generation:{selection:{...image.generation!.selection!,model:'original-video'},connectionName:'原视频连接',prompt:'冻结视频动作',firstFrameMaterialRevisionId:'ref-original',durationSeconds:5,firstFrameFit:'cover' as const,videoSettings:{resolution:'1080P' as const,audio:false,promptExtend:true,shotType:'single' as const,watermark:false,negativePrompt:'不要变形',seed:123}}};
 render(<WorkspaceVisualPreparation workspace={{...workspace,visualCandidates:[image,video],selectedImages:[{targetItemId:'item',candidateId:'image',materialRevisionId:'backup'}]}} readOnly command={vi.fn()} onChange={vi.fn()} materials={[]} currentVisualPath="frozen.mp4" currentVisualKind="video"/>);
 expect(screen.getByText('当前采用 · 视频')).toBeTruthy();expect(screen.getByText('已选备用图片 · 图片')).toBeTruthy();expect(screen.getByText('冻结视频动作')).toBeTruthy();expect(screen.getByText('5 s')).toBeTruthy();expect(screen.getByText('1080P')).toBeTruthy();expect(screen.getByText('不要变形')).toBeTruthy();expect(screen.queryByRole('button',{name:/复用|生成|采用/})).toBeNull();
});
it('does not fabricate historical parameters for an old project without generation snapshots',()=>{
 render(<WorkspaceVisualPreparation workspace={{...workspace,visualCandidates:[]}} readOnly command={vi.fn()} onChange={vi.fn()} materials={[]} currentVisualPath="old.mp4" currentVisualKind="video"/>);
 expect(screen.getByText('当前画面来自已保存工程，未找到对应制作请求。')).toBeTruthy();expect(screen.getByText('此工程未保留画面生成快照，无法还原当时的制作参数。')).toBeTruthy();expect(screen.queryByText('自动')).toBeNull();expect(document.querySelector('input,textarea,select')).toBeNull();
});
it('preserves frozen failed requests even when no candidate exists, without offering a new generation',()=>{
 render(<WorkspaceVisualPreparation workspace={{...workspace,visualCandidates:[],visualTasks:[{id:'request',taskId:'task-original',targetItemId:'item',kind:'image',status:'failed',error:'已拒绝',generation:{prompt:'未产出的原请求',firstFrameMaterialRevisionId:'',durationSeconds:0,imageSettings:{size:'1024x1536',count:1,quality:'high'}}}]}} readOnly command={vi.fn()} onChange={vi.fn()} materials={[]}/>);
 expect(screen.getByText('未产出的原请求')).toBeTruthy();expect(screen.getByText('task-original')).toBeTruthy();expect(screen.getByText('已拒绝')).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();
});
