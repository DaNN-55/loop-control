import {videoProviders,minimaxVideoModels} from '../worker/videoProviderCatalog';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import {registeredAdapters,firstFrameVideoMode} from '../worker/registeredAdapters';
import {openAiImageModels,imageSizePresets,openAiImageQualities,emptyImageBrief} from '../imageGeneration';
import {wanVideoModels,defaultWanModelSettings} from '../wanVideoModels';
import type {ProductionWorkspace} from '../productionWorkspace';
const image={id:'ref-1',material_type:'image',source_path:'reference.png',storage_path:'reference.png',mime_type:'image/png',file_size:100},tail={...image,id:'ref-2',source_path:'tail.png',storage_path:'tail.png'},video={id:'video-1',material_type:'video',source_path:'reference.mp4',storage_path:'reference.mp4',mime_type:'video/mp4',file_size:100};
const w={id:'binding',episodeId:'binding-episode',revision:1,project:{sha256:'original'},clips:[{id:'clip',itemId:'target',shotId:'shot',text:'测试'}],visualTasks:[],visualCandidates:[],visualTargets:[],selectedImages:[],stale:false} as unknown as ProductionWorkspace;
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
function setup(provider:string,model:string,kind:'image'|'video',draft:Record<string,unknown>={}){
 const choice=registeredAdapters.productionChoices().find(c=>c.provider===provider&&c.capability===kind)!;
 const service={...choice,id:'binding-service',connectionVersionId:'version',connectionName:'测试连接',executable:true,models:[model]},selection={capability:kind,provider,adapter:choice.adapter,connectionVersionId:'version',model};
 sessionStorage.setItem('loop-visual-draft:binding:target',JSON.stringify({tab:kind,origin:{image:'generate',video:'generate'},settings:{size:'1024x1024',quality:'low',count:1},references:kind==='image'?[image.id]:[],imageBrief:emptyImageBrief,imagePrompt:'图片动作',videoPrompt:'视频动作',duration:'5',imageSelection:kind==='image'?selection:undefined,videoSelection:kind==='video'?selection:undefined,videoSettings:provider==='bailian'?defaultWanModelSettings(model):undefined,...draft}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace:w,serviceCatalog:{groups:[{capability:kind,services:[service]}]}})));
 const command=vi.fn(async()=>w);render(<WorkspaceVisualPreparation workspace={w} materials={[image,tail,video]} command={command} onChange={()=>{}}/>);
 return{command,selection};
}
async function send(command:ReturnType<typeof vi.fn>,label:string){const before=command.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:label}));await waitFor(()=>expect(command.mock.calls.length).toBe(before+1));return command.mock.calls.at(-1)![1] as any;}

const referenceUiCases=[
 ...openAiImageModels.map(model=>({provider:'openai',model,kind:'image' as const,mode:'images',video:false})),
 ...[...Object.entries(videoProviders).flatMap(([provider,p])=>p.models.map(model=>({provider,model}))),...Object.keys(wanVideoModels).map(model=>({provider:'bailian',model}))].flatMap(({provider,model})=>{
  const modes=registeredAdapters.productionChoices().find(choice=>choice.provider===provider&&choice.capability==='video')?.videoGenerationModes?.[model]??[firstFrameVideoMode()];
  return modes.map(mode=>({provider,model,kind:'video' as const,mode:mode.id,video:!!mode.inputs.referenceVideos}));
 }),
];
it.each(referenceUiCases)('$model $mode: actual prompt insertion submits its exact material binding',async({provider,model,kind,mode,video:useVideo})=>{
 const duration=provider==='bailian'?wanVideoModels[model].durations[0]:4;
 const {command}=setup(provider,model,kind,{videoInputIds:mode==='keyframes'?[image.id,tail.id]:useVideo?[image.id,video.id]:[image.id],videoModeId:mode,duration:String(duration),referenceVideoSources:{[image.id]:'https://media.example.com/image.png',[video.id]:'https://media.example.com/reference.mp4'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:kind==='image'?'图片连接与模型':'视频连接与模型'}).textContent).toContain(model));
 const token=useVideo?'@视频1':'@图片1',materialRevisionId=useVideo?video.id:image.id;
 fireEvent.change(screen.getByRole('textbox',{name:kind==='image'?'图片提示词':'画面动作'}),{target:{value:'让@'}});
 fireEvent.click(screen.getByRole('option',{name:new RegExp(token)}));
 const request=await send(command,kind==='image'?'生成图片':'生成视频');
 expect(request.prompt).toBe(`让${token} `);expect(request.promptReferences).toEqual([{token,materialRevisionId}]);
 if(kind==='image')expect(request.referenceMaterialRevisionIds).toContain(materialRevisionId);
 else if(mode==='first-frame')expect(request.firstFrameMaterialRevisionId).toBe(materialRevisionId);
 else expect(request.visualInputs.some((entry:any)=>entry.materialRevisionId===materialRevisionId)).toBe(true);
});

it.each(openAiImageModels)('%s: UI dimensions, quality, count and reference brief reach the submitted command',async model=>{
 const {command,selection}=setup('openai',model,'image');await waitFor(()=>expect(screen.getByRole('button',{name:'图片连接与模型'}).textContent).toContain(model));
 for(const preset of imageSizePresets)for(const tier of ['standard','high'] as const){
  fireEvent.click(screen.getByRole('button',{name:'图片规格'}));
  fireEvent.click(within(screen.getByRole('group',{name:'图片画面比例'})).getByRole('button',{name:preset.ratio}));
  fireEvent.click(within(screen.getByRole('group',{name:'图片实际像素'})).getByRole('button',{name:tier==='high'?'高分辨率':'标准'}));
  fireEvent.click(screen.getByRole('button',{name:'关闭图片规格'}));
  expect((await send(command,'生成图片')).settings.size).toBe(preset[tier]);
 }
 for(const quality of openAiImageQualities(model)){
  fireEvent.click(screen.getByRole('button',{name:'图片规格'}));fireEvent.change(screen.getByRole('combobox',{name:'图片质量'}),{target:{value:quality}});fireEvent.click(screen.getByRole('button',{name:'关闭图片规格'}));
  expect((await send(command,'生成图片')).settings.quality).toBe(quality);
 }
 for(const count of [1,2,4]){
  fireEvent.click(screen.getByRole('button',{name:'生成数量'}));fireEvent.click(screen.getByRole('button',{name:`生成 ${count} 张图片`}));fireEvent.click(screen.getByRole('button',{name:'关闭生成数量'}));
  expect((await send(command,'生成图片')).settings.count).toBe(count);
 }
 fireEvent.click(screen.getByRole('button',{name:'编辑参考图 1 用途'}));
 fireEvent.change(screen.getByRole('combobox',{name:'参考图 1 用途'}),{target:{value:'character'}});fireEvent.change(screen.getByRole('textbox',{name:'参考图 1 需要保留'}),{target:{value:'衣服'}});fireEvent.change(screen.getByRole('textbox',{name:'参考图 1 允许改变'}),{target:{value:'光线'}});
 fireEvent.click(screen.getByRole('button',{name:'构图与字幕留白'}));fireEvent.change(screen.getByRole('combobox',{name:'图片主体构图'}),{target:{value:'full-with-margin'}});fireEvent.change(screen.getByRole('combobox',{name:'图片字幕留白'}),{target:{value:'bottom'}});fireEvent.click(screen.getByRole('button',{name:'关闭构图与字幕留白'}));
 for(const purpose of ['subject','character','product','style','composition']){
  fireEvent.change(screen.getByRole('combobox',{name:'参考图 1 用途'}),{target:{value:purpose}});
  expect((await send(command,'生成图片')).imageBrief.references[0].purpose).toBe(purpose);
 }
 fireEvent.change(screen.getByRole('combobox',{name:'参考图 1 用途'}),{target:{value:'character'}});
 for(const [value,framing,crop] of [['auto','auto','allow'],['full','full','allow'],['full-with-margin','full','protect'],['close','close','allow']]){
  fireEvent.click(screen.getByRole('button',{name:'构图与字幕留白'}));fireEvent.change(screen.getByRole('combobox',{name:'图片主体构图'}),{target:{value}});fireEvent.click(screen.getByRole('button',{name:'关闭构图与字幕留白'}));
  expect((await send(command,'生成图片')).imageBrief).toMatchObject({framing,crop});
 }
 for(const captionSpace of ['none','top','bottom']){
  fireEvent.click(screen.getByRole('button',{name:'构图与字幕留白'}));fireEvent.change(screen.getByRole('combobox',{name:'图片字幕留白'}),{target:{value:captionSpace}});fireEvent.click(screen.getByRole('button',{name:'关闭构图与字幕留白'}));
  expect((await send(command,'生成图片')).imageBrief.captionSpace).toBe(captionSpace);
 }
 fireEvent.click(screen.getByRole('button',{name:'构图与字幕留白'}));fireEvent.change(screen.getByRole('combobox',{name:'图片主体构图'}),{target:{value:'full-with-margin'}});fireEvent.click(screen.getByRole('button',{name:'关闭构图与字幕留白'}));
 const request=await send(command,'生成图片');expect(request).toMatchObject({selection,referenceMaterialRevisionIds:[image.id],imageBrief:{framing:'full',crop:'protect',captionSpace:'bottom',references:[{materialRevisionId:image.id,purpose:'character',preserve:'衣服',change:'光线'}]}});
},30000);

it.each(Object.keys(wanVideoModels))('%s: UI advanced settings and supported input mode reach the command',async model=>{
 const profile=wanVideoModels[model],reference=model==='wan2.6-r2v';
 const {command,selection}=setup('bailian',model,'video',{duration:String(profile.durations[0]),videoInputIds:[image.id],videoModeId:reference?'references':'first-frame',referenceVideoSources:reference?{[image.id]:'https://cdn.aliyuncs.com/reference.png'}:{}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain(model));
 fireEvent.click(screen.getByRole('button',{name:'视频规格'}));fireEvent.click(within(screen.getByRole('group',{name:'视频分辨率'})).getByRole('button',{name:profile.resolutions.at(-1)!}));fireEvent.click(screen.getByRole('button',{name:'关闭视频规格'}));
 fireEvent.click(screen.getByRole('button',{name:'高级视频设置'}));fireEvent.change(screen.getByRole('textbox',{name:'视频负面提示词'}),{target:{value:'不要文字'}});fireEvent.change(screen.getByRole('spinbutton',{name:'视频随机种子'}),{target:{value:'17'}});fireEvent.click(screen.getByRole('checkbox',{name:'添加模型水印'}));
 if(!reference)fireEvent.click(screen.getByRole('checkbox',{name:'智能扩写提示词'}));
 if(profile.multiShot)fireEvent.change(screen.getByRole('combobox',{name:'视频镜头结构'}),{target:{value:'multi'}});
 if(profile.audio==='optional')fireEvent.click(screen.getByRole('checkbox',{name:'生成视频声音'}));
 fireEvent.click(screen.getByRole('button',{name:'关闭高级视频设置'}));
 const request=await send(command,'生成视频');expect(request).toMatchObject({selection,durationSeconds:profile.durations[0],videoSettings:{resolution:profile.resolutions.at(-1),negativePrompt:'不要文字',seed:17,watermark:true,audio:profile.audio!=='silent',promptExtend:!reference,shotType:profile.multiShot?'multi':'single'}});
 if(reference)expect(request).toMatchObject({videoMode:'references',visualInputs:[{role:'referenceImages',materialRevisionId:image.id,source:'https://cdn.aliyuncs.com/reference.png'}]});else expect(request.firstFrameMaterialRevisionId).toBe(image.id);
 for(const durationSeconds of profile.durations){
  fireEvent.click(screen.getByRole('button',{name:'生成时长'}));fireEvent.change(screen.getByRole('spinbutton',{name:'生成时长（秒）'}),{target:{value:String(durationSeconds)}});fireEvent.click(screen.getByRole('button',{name:'关闭生成时长'}));
  expect((await send(command,'生成视频')).durationSeconds).toBe(durationSeconds);
 }
 for(const seed of [0,2147483647,undefined]){
  fireEvent.click(screen.getByRole('button',{name:'高级视频设置'}));fireEvent.change(screen.getByRole('spinbutton',{name:'视频随机种子'}),{target:{value:seed===undefined?'':String(seed)}});fireEvent.click(screen.getByRole('button',{name:'关闭高级视频设置'}));
  expect((await send(command,'生成视频')).videoSettings.seed).toBe(seed);
 }
 fireEvent.click(screen.getByRole('button',{name:'高级视频设置'}));fireEvent.click(screen.getByRole('checkbox',{name:'添加模型水印'}));
 if(profile.audio==='optional')fireEvent.click(screen.getByRole('checkbox',{name:'生成视频声音'}));
 if(!reference)fireEvent.click(screen.getByRole('checkbox',{name:'智能扩写提示词'}));else fireEvent.change(screen.getByRole('combobox',{name:'视频镜头结构'}),{target:{value:'single'}});
 fireEvent.click(screen.getByRole('button',{name:'关闭高级视频设置'}));
 expect((await send(command,'生成视频')).videoSettings).toMatchObject({watermark:false,audio:profile.audio==='always',promptExtend:false,shotType:'single'});

},15000);

it.each(Object.keys(minimaxVideoModels).flatMap(model=>['first-frame','keyframes','references'].map(mode=>({model,mode}))))('$model $mode: UI mode and resolution change submitted visual roles',async({model,mode})=>{
 const {command}=setup('minimax',model,'video',{videoInputIds:mode==='first-frame'?[image.id]:mode==='keyframes'?[image.id,tail.id]:[image.id,video.id],videoModeId:'first-frame'});
 await waitFor(()=>expect(screen.getByRole('button',{name:'视频连接与模型'}).textContent).toContain(model));
 fireEvent.click(screen.getByRole('button',{name:'画面输入模式'}));fireEvent.click(within(screen.getByRole('group',{name:'生成模式'})).getByRole('button',{name:mode==='references'?'参考素材生成':mode==='keyframes'?'首尾帧生成':'首帧生成'}));
 if(mode!=='references')fireEvent.click(screen.getByRole('button',{name:'居中裁切 填满画面'}));
 fireEvent.click(screen.getByRole('button',{name:'关闭画面输入模式'}));
 for(const resolution of minimaxVideoModels[model].resolutions){
 fireEvent.click(screen.getByRole('button',{name:'视频规格'}));fireEvent.click(within(screen.getByRole('group',{name:'视频分辨率'})).getByRole('button',{name:resolution}));fireEvent.click(screen.getByRole('button',{name:'关闭视频规格'}));
 const request=await send(command,'生成视频');expect(request.selection.model).toBe(model);expect(request.videoResolution).toBe(resolution);
 if(mode==='first-frame')expect(request).toMatchObject({firstFrameMaterialRevisionId:image.id,firstFrameFit:'cover'});
 else expect(request).toMatchObject({videoMode:mode,visualInputs:mode==='keyframes'?[{role:'firstFrame',materialRevisionId:image.id},{role:'lastFrame',materialRevisionId:tail.id}]:[{role:'referenceImages',materialRevisionId:image.id},{role:'referenceVideos',materialRevisionId:video.id}]});
 }
});
