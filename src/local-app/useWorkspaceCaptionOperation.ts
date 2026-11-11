import {useEffect,useMemo,useReducer,useRef} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import {readWorkspaceCaption} from '../workspaceCaptions';
import type {ShotCaptionContract} from '../shotCaptions';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import {useWorkspaceReading} from './useWorkspaceReading';

type CaptionCommand='saveWorkspaceCaptions'|'requestWorkspaceCaptionAlignment'|'applyWorkspaceCaptionAlignment'|'confirmWorkspaceCaptionText';
type Phase='save-native'|'read-base'|'prepare-alignment'|'apply-native'|'read-applied'|'register';
interface Attempt {
 name:CaptionCommand;extra:Record<string,unknown>;requested:ShotCaptionContract;native?:ShotCaptionContract;nativeFingerprint?:string;
 phase:Phase;base:ProductionWorkspace;inputFingerprint?:string;data?:Record<string,unknown>;
}
interface Options {
 workspace:ProductionWorkspace;clipId:string;itemId?:string;inputFingerprint?:string;contract:ShotCaptionContract;
 bridge?:EmbeddedStudioBridge;readOnly:boolean;
 command:(name:string,data:unknown)=>Promise<unknown>;onChange:(workspace:ProductionWorkspace)=>void;
 onSaved:(submitted:ShotCaptionContract)=>void;
}
const messages:Record<Phase,string>={
 'save-native':'正在保存当前工程…','read-base':'正在核对保存版本…','prepare-alignment':'正在核对对齐结果…',
 'apply-native':'正在写入工程字幕…','read-applied':'字幕已写入工程，正在读取保存版本…','register':'正在登记字幕结果…',
};
/** ADR-0039: a frozen caption intent resumes only its unfinished local stage. */
export function useWorkspaceCaptionOperation(options:Options){
 const latest=useRef(options);latest.current=options;
 const owner=useMemo(()=>({generation:0,busy:false,attempt:null as Attempt|null,error:'',progress:''}),[options.workspace.episodeId,options.workspace.id,options.workspace.scriptRevisionId,options.clipId]);
 const active=useRef(owner);active.current=owner;
 const [,render]=useReducer((value:number)=>value+1,0);
 const reading=useWorkspaceReading(options.workspace,options.onChange,options.clipId,'无法读取当前保存版本。');
 useEffect(()=>{owner.generation++;return()=>{owner.generation++;owner.busy=false;owner.attempt=null;};},[owner]);
 function reset(){if(owner.busy)return;owner.attempt=null;owner.error='';owner.progress='';render();}
 async function execute(attempt:Attempt,resuming=false){
  const current=latest.current;
  if(owner.busy||current.readOnly||current.workspace.stale||current.bridge&&!current.bridge.connected)return;
  if(resuming&&JSON.stringify(current.contract)!==JSON.stringify(attempt.requested)){reset();owner.error='字幕输入已变化，请核对后重新操作。';render();return;}
  const generation=owner.generation;
  const owns=()=>active.current===owner&&owner.generation===generation;
  const check=()=>{if(!owns()||latest.current.readOnly||latest.current.workspace.stale)throw Object.assign(Error('字幕操作已结束。'),{name:'AbortError'});};
  function phase(value:Phase){check();attempt.phase=value;owner.progress=messages[value];render();}
  async function readCurrent(){
   const value=await reading.read();check();
   if(value.scriptRevisionId!==current.workspace.scriptRevisionId)throw Error('工程脚本已变化，请重新核对字幕。');
   if(!value.clips.some(clip=>clip.id===options.clipId&&clip.itemId===options.itemId))throw Error('当前字幕片段已变化，请重新选择。');
   return value;
  }
  let observed:ProductionWorkspace|undefined;
  owner.busy=true;owner.attempt=attempt;owner.error='';owner.progress=messages[attempt.phase];render();
  try{
   if(resuming&&attempt.phase==='register'){
    if(attempt.native&&current.bridge){
     const live=await current.bridge.inspect();check();
     if(attempt.nativeFingerprint&&live.documentFingerprint!==attempt.nativeFingerprint)throw Error('编辑器已有新修改，请核对后重新操作。');
    }
    observed=await readCurrent();
    if(observed.scriptRevisionId!==attempt.base.scriptRevisionId)throw Error('工程脚本已变化，请重新核对字幕。');
    const saved=observed.captions?.find(c=>c.clipId===options.clipId||c.itemId===options.itemId);
    if(attempt.native&&JSON.stringify(saved?.contract)!==JSON.stringify(attempt.native))throw Error('工程字幕已变化，请核对当前内容后重新操作。');
    // A non-native save may have committed a new SHA. The frozen command must reach
    // the Owner receipt lookup before its original CAS can reject an unrelated change.
   }
   if(attempt.phase==='save-native'){
    await current.bridge!.save();check();phase('read-base');
   }
   if(attempt.phase==='read-base'){
    attempt.base=await readCurrent();phase(attempt.name==='applyWorkspaceCaptionAlignment'?'prepare-alignment':'register');
   }
   if(attempt.phase==='prepare-alignment'){
    const prepared=await current.command('prepareWorkspaceCaptionAlignment',{episodeId:attempt.base.episodeId,workspaceId:attempt.base.id,expectedRevision:attempt.base.revision,clipId:options.clipId,expectedInputFingerprint:attempt.inputFingerprint,...attempt.extra}) as {captionContract:ShotCaptionContract};
    check();attempt.native=prepared.captionContract;phase('apply-native');
   }
   if(attempt.phase==='apply-native'){
    const native=await current.bridge!.applyCaptions(options.itemId!,attempt.native??attempt.requested,attempt.name==='applyWorkspaceCaptionAlignment');
    check();attempt.native=native;phase('read-applied');
   }
   if(attempt.phase==='read-applied'){
    const live=await current.bridge!.inspect();check();
    if(attempt.nativeFingerprint&&live.documentFingerprint!==attempt.nativeFingerprint)throw Error('编辑器已有新修改，请核对后重新操作。');
    if(JSON.stringify(readWorkspaceCaption(live.document,options.itemId!)?.contract)!==JSON.stringify(attempt.native))throw Error('编辑器字幕已变化，请核对后重新操作。');
    attempt.nativeFingerprint=live.documentFingerprint;
    attempt.base=await readCurrent();
    const saved=attempt.base.captions?.find(c=>c.clipId===options.clipId||c.itemId===options.itemId);
    if(JSON.stringify(saved?.contract)!==JSON.stringify(attempt.native))throw Error('工程字幕已变化，请核对当前内容后重新操作。');
    phase('register');
   }
   if(!attempt.data){
    attempt.data={episodeId:attempt.base.episodeId,workspaceId:attempt.base.id,expectedRevision:attempt.base.revision,clipId:options.clipId,
     ...(attempt.name==='saveWorkspaceCaptions'?{captionContract:attempt.native??attempt.requested}:attempt.name==='requestWorkspaceCaptionAlignment'?{}:{expectedInputFingerprint:attempt.inputFingerprint}),
     ...(current.bridge&&['saveWorkspaceCaptions','applyWorkspaceCaptionAlignment'].includes(attempt.name)?{nativeApplied:true}:{}),...attempt.extra};
   }
   const result=await current.command(attempt.name,attempt.data) as ProductionWorkspace|{workspace:ProductionWorkspace};check();
   const saved='workspace' in result?result.workspace:result;
   if(saved.id!==attempt.base.id||saved.episodeId!==attempt.base.episodeId)throw Error('字幕保存结果不属于当前工程，请重新核对。');
   if(!observed||saved.revision>observed.revision)reading.publish(saved);
   if(attempt.name==='saveWorkspaceCaptions')latest.current.onSaved(attempt.requested);
   owner.attempt=null;owner.progress='';
  }catch(cause){if(owns()&&!(cause instanceof Error&&cause.name==='AbortError')){owner.error=cause instanceof Error?cause.message:'字幕操作未完成。';owner.progress=attempt.native&&attempt.phase!=='apply-native'?'字幕已写入工程，后续登记尚未确认。':'字幕操作尚未确认，可核对后继续。';}}
  finally{if(owns()){owner.busy=false;render();}}
 }
 return {pending:owner.busy,error:owner.error,progress:owner.progress,canResume:!!owner.attempt&&!owner.busy,
  reset,resume:()=>owner.attempt?execute(owner.attempt,true):Promise.resolve(),
  run:(name:CaptionCommand,extra:Record<string,unknown>={})=>execute({name,extra:{...extra},requested:options.contract,base:options.workspace,inputFingerprint:options.inputFingerprint,phase:options.bridge?(name==='saveWorkspaceCaptions'?'apply-native':'save-native'):'register'}),
 };
}
