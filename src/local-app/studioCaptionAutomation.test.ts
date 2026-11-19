import {expect,it,vi} from 'vitest';
import {applyStudioCaptionAlignment} from './studioCaptionAutomation';
import {defaultShotCaptionContract} from '../shotCaptions';
import {applyWorkspaceCaptionEdit,readWorkspaceCaption} from '../workspaceCaptions';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
function fixture(){
 const contract={...defaultShotCaptionContract('新口播。','independent'),cues:[{id:'old',text:'新口播。',startMs:0,endMs:1000}]};
 let document=applyWorkspaceCaptionEdit({version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[{id:'v',kind:'image',track:'V1',startFrame:0,durationInFrames:60}],trackOrder:['V1'],tracks:{V1:{kind:'video',name:'video'}},transitions:[],selectedId:null,captionsHidden:false}]} as OpenChatCutProject,'v',contract);
 let fingerprint='baseline';const workspace={id:'w',episodeId:'e',revision:1,captions:[{clipId:'c',itemId:'v',inputFingerprint:'voice-v2',taskId:'task',contract:readWorkspaceCaption(document,'v')!.contract}]} as unknown as ProductionWorkspace;
 const bridge={connected:true,inspect:async()=>({document,revision:1,documentFingerprint:fingerprint}),applyCaptions:vi.fn(async(_id,next)=>{document=applyWorkspaceCaptionEdit(document,'v',next,{timingOnly:true});return readWorkspaceCaption(document,'v')!.contract;})} as unknown as EmbeddedStudioBridge;
 const aligned={...contract,cues:[{id:'new',text:'新口播。',startMs:200,endMs:850}]};
 const command=vi.fn(async(name:string)=>name==='prepareWorkspaceCaptionAlignment'?{captionContract:aligned}:{...workspace,captions:[{...workspace.captions![0],contract:aligned,timing:'current'}]});
 return{workspace,bridge,command,read:async()=>({...workspace,revision:2}),get document(){return document;},manual(){fingerprint='manual-newer';document=applyWorkspaceCaptionEdit(document,'v',{...contract,cues:[{id:'manual',text:'新口播。',startMs:400,endMs:900}]});}};
}
it('applies only prepared phrase timing to the native document and registers its saved version',async()=>{
 const f=fixture(),result=await applyStudioCaptionAlignment({...f,caption:f.workspace.captions![0]});
 expect(readWorkspaceCaption(f.document,'v')!.contract.cues[0]).toMatchObject({startMs:200,endMs:850});
 expect(result.captions![0].timing).toBe('current');
 expect(f.bridge.applyCaptions).toHaveBeenCalledWith('v',expect.anything(),true,'baseline');
 expect(f.command).toHaveBeenLastCalledWith('applyWorkspaceCaptionAlignment',expect.objectContaining({expectedRevision:2,automatic:true,nativeApplied:true,expectedInputFingerprint:'voice-v2'}));
});
it('does not overwrite a manual timing change made while the acoustic result is being prepared',async()=>{
 const f=fixture();f.command.mockImplementationOnce(async()=>{f.manual();return{captionContract:f.workspace.captions![0].contract};});
 await expect(applyStudioCaptionAlignment({...f,caption:f.workspace.captions![0]})).rejects.toThrow('新修改');
 expect(readWorkspaceCaption(f.document,'v')!.contract.cues[0].startMs).toBe(400);expect(f.bridge.applyCaptions).not.toHaveBeenCalled();
});
