import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceCaptionState} from '../workspaceCaptions';
import {readWorkspaceCaption} from '../workspaceCaptions';
import type {ShotCaptionContract} from '../shotCaptions';

/** A background result may change timing only on the exact native document it observed. */
export async function applyStudioCaptionAlignment({workspace,caption,bridge,command,read,isCurrent=()=>true}:{workspace:ProductionWorkspace;caption:WorkspaceCaptionState;bridge:EmbeddedStudioBridge;command:(name:string,data:unknown)=>Promise<unknown>;read:()=>Promise<ProductionWorkspace>;isCurrent?:()=>boolean}):Promise<ProductionWorkspace>{
 const check=()=>{if(!isCurrent())throw Object.assign(Error('字幕操作已结束。'),{name:'AbortError'});};
 const before=await bridge.inspect();check();
 const native=readWorkspaceCaption(before.document,caption.itemId)?.contract;
 if(!native||native.enabled!==caption.contract.enabled||native.text!==caption.contract.text||JSON.stringify(native.cues)!==JSON.stringify(caption.contract.cues))throw Error('字幕已有新修改，自动结果不再覆盖。');
 const base={episodeId:workspace.episodeId,workspaceId:workspace.id,clipId:caption.clipId,taskId:caption.taskId,expectedInputFingerprint:caption.inputFingerprint,automatic:true};
 const prepared=await command('prepareWorkspaceCaptionAlignment',{...base,expectedRevision:workspace.revision}) as {captionContract:ShotCaptionContract};check();
 const current=await bridge.inspect();check();
 if(current.documentFingerprint!==before.documentFingerprint)throw Error('编辑器已有新修改，自动字幕结果未应用。');
 await bridge.applyCaptions(caption.itemId,prepared.captionContract,true,before.documentFingerprint);check();
 const saved=await read();check();
 const result=await command('applyWorkspaceCaptionAlignment',{...base,expectedRevision:saved.revision,nativeApplied:true}) as ProductionWorkspace;check();
 return result;
}
