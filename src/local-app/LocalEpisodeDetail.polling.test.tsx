import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {LocalEpisodeDetail} from './LocalEpisodeDetail';

beforeEach(()=>{vi.useFakeTimers();Object.defineProperty(document,'hidden',{configurable:true,value:false});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();Object.defineProperty(document,'hidden',{configurable:true,value:false});});
function fixture(stage='production_completed',tasks:Array<Record<string,unknown>>=[]){
 let current={episode:{id:'poll',account_id:'a',title:'轮询验证',stage,archived_at:null,main_script_revision_id:null},blueprint:null,seriesVersion:null,materialRevisions:[],audioTracks:[],tasks,taskRuns:[],artifacts:[],reviewPackages:[],transitions:[],preRenderReviewMembers:[],preRenderReviewMemberDecisions:[],audioTrackAnnotations:[],connectionVersions:[],qcReviewIssues:[],reviewAnnotations:[],shotPreparationDrafts:[],storyboardAudioSelections:[]};
 let hold:(()=>Promise<void>)|undefined;
 const reads:Array<Record<string,unknown>>=[];const changed=vi.fn(async()=>{});
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.includes('?known=')){const captured=structuredClone(current);reads.push(captured);const wait=hold;hold=undefined;await wait?.();return Response.json({hashes:{},sections:captured});}
  if(path.endsWith('/workspace'))return Response.json({workspace:null});
  throw Error(`Unexpected ${path}`);
 }));
 return{reads,changed,holdNext:()=>{let release!:()=>void;hold=()=>new Promise<void>(resolve=>{release=resolve;});return()=>release();},set:(next:Partial<typeof current>)=>{current={...current,...next};},view:()=>render(<LocalEpisodeDetail episodeId="poll" onClose={()=>{}} onChanged={changed}/>)};
}
async function settle(){await act(async()=>{await Promise.resolve();});}
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
async function visible(hidden:boolean){Object.defineProperty(document,'hidden',{configurable:true,value:hidden});await act(async()=>document.dispatchEvent(new Event('visibilitychange')));}
it('无活动任务的完成详情每30秒读取；隐藏停止读取，恢复立即读取最新变化',async()=>{
 const f=fixture();f.view();await settle();expect(f.reads).toHaveLength(1);
 await advance(29999);expect(f.reads).toHaveLength(1);await advance(1);expect(f.reads).toHaveLength(2);
 await visible(true);await advance(90000);expect(f.reads).toHaveLength(2);
 f.set({episode:{...f.reads[0].episode as any,title:'后台已更新',id:'poll'}});
 await visible(false);expect(f.reads).toHaveLength(3);expect(screen.getByRole('heading',{name:'后台已更新'})).toBeTruthy();expect(f.changed).toHaveBeenCalledTimes(3);
});
it.each(['ready','running'])('完成详情的%s任务仍每2秒更新，完成后转为30秒',async(status)=>{
 const f=fixture('production_completed',[{id:'task',status}]);f.view();await settle();
 await advance(2000);expect(f.reads).toHaveLength(2);
 f.set({tasks:[{id:'task',status:'completed'}]});await advance(2000);expect(f.reads).toHaveLength(3);
 await advance(29999);expect(f.reads).toHaveLength(3);await advance(1);expect(f.reads).toHaveLength(4);
});
it('未完成生产单维持2秒，隐藏时不补发积压的轮询',async()=>{
 const f=fixture('waiting_input');f.view();await settle();await advance(2000);expect(f.reads).toHaveLength(2);
 await visible(true);await advance(60000);expect(f.reads).toHaveLength(2);await visible(false);expect(f.reads).toHaveLength(3);
 await advance(1999);expect(f.reads).toHaveLength(3);await advance(1);expect(f.reads).toHaveLength(4);
});

it('页面恢复发生在旧请求未返回时，旧回执之后立即再读，保留后台完成更新',async()=>{
 const f=fixture('production_completed',[{id:'task',status:'running'}]);f.view();await settle();
 const release=f.holdNext();await advance(2000);expect(f.reads).toHaveLength(2);
 await visible(true);f.set({tasks:[{id:'task',status:'completed'}],episode:{...f.reads[0].episode as any,title:'后台完成结果',id:'poll'}});
 await visible(false);expect(f.reads).toHaveLength(2);await act(async()=>release());await settle();
 expect(f.reads).toHaveLength(3);expect(screen.getByRole('heading',{name:'后台完成结果'})).toBeTruthy();
 await advance(29999);expect(f.reads).toHaveLength(3);
});
