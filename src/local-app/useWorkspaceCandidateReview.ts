import {useEffect,useMemo,useRef,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import type {WorkspaceReading} from './useWorkspaceReading';

interface ReviewPlan {candidateId:string;projectSha256:string;}
/** The two media protocols own their commands; this module owns review lifetime. */
export function useCandidateReviewLifecycle<Choice,Plan extends ReviewPlan>({workspace,scope,reader,prepare:preparePlan,adopt}:{workspace:ProductionWorkspace;scope:string;reader:WorkspaceReading;prepare:(current:ProductionWorkspace,choice:Choice)=>Promise<Plan>;adopt:(current:ProductionWorkspace,plan:Plan)=>Promise<ProductionWorkspace>}){
 const identity=JSON.stringify([workspace.episodeId,workspace.id,scope]);
 const owner=useMemo(()=>({active:true,sequence:0,stage:'idle' as 'idle'|'prepare-read'|'preparing'|'confirm-read'|'adopting',latest:workspace,provided:workspace}),[identity]);
 const active=useRef(owner);active.current=owner;
 const [review,setReview]=useState<{owner:typeof owner;sequence:number;plan:Plan}|null>(null),[pending,setPending]=useState<{owner:typeof owner;sequence:number}|null>(null);
 if(workspace!==owner.provided){
  owner.provided=workspace;
  if(workspace.revision>=owner.latest.revision){
   // Fresh reads establish their own baseline. Posted adoption may legitimately change SHA.
   if(workspace.project?.sha256!==owner.latest.project?.sha256&&(owner.stage==='preparing'||owner.stage==='idle')){owner.sequence++;owner.stage='idle';}
   owner.latest=workspace;
  }
 }
 useEffect(()=>{owner.active=true;return()=>{owner.active=false;owner.sequence++;};},[owner]);
 const owns=()=>owner.active&&active.current===owner;
 const ownsRequest=(sequence:number)=>owns()&&sequence===owner.sequence;
 const plan=review?.owner===owner&&review.sequence===owner.sequence?review.plan:null;
 async function prepare(choice:Choice){
  if(!owns()||owner.stage==='confirm-read'||owner.stage==='adopting')return;
  const sequence=++owner.sequence;owner.stage='prepare-read';setReview(null);setPending({owner,sequence});
  try{
   const current=await reader.read();if(!ownsRequest(sequence))return;
   owner.latest=current;owner.stage='preparing';
   const prepared=await preparePlan(current,choice);if(!ownsRequest(sequence)||prepared.projectSha256!==owner.latest.project?.sha256)return;
   setReview({owner,sequence,plan:prepared});
  }catch(error){if(ownsRequest(sequence))throw error;}
  finally{if(ownsRequest(sequence)){owner.stage='idle';setPending(null);}}
 }
 async function confirm(onConfirmed?:(changed:ProductionWorkspace,plan:Plan)=>void){
  if(!plan||review?.sequence!==owner.sequence||!owns()||owner.stage!=='idle')return;
  const sequence=++owner.sequence;owner.stage='confirm-read';setReview(null);setPending({owner,sequence});
  try{
   const current=await reader.read();if(!ownsRequest(sequence))return;
   owner.latest=current;
   if(current.project?.sha256!==plan.projectSha256)throw Error('工程已变化，请重新核对采用影响。');
   owner.stage='adopting';
   const changed=await adopt(current,plan);
   // A posted command can complete after local cancellation; publishing does not undo it.
   if(owns())reader.publish(changed);
   if(ownsRequest(sequence))onConfirmed?.(changed,plan);
  }catch(error){if(ownsRequest(sequence))throw error;}
  finally{if(owns()&&(ownsRequest(sequence)||owner.stage==='adopting')){owner.stage='idle';setPending(null);}}
 }
 function cancel(){owner.sequence++;if(owner.stage!=='adopting'){owner.stage='idle';setPending(null);}setReview(null);}
 return{plan,pending:owner.stage==='adopting'||pending?.owner===owner&&pending.sequence===owner.sequence,prepare,confirm,cancel};
}

/** Narration and the retained native entry point keep their command protocols here. */
export function useWorkspaceCandidateReview({workspace,scope,reader,command,bridge}:{workspace:ProductionWorkspace;scope:string;reader:WorkspaceReading;command:(name:string,data:unknown)=>Promise<unknown>;bridge?:EmbeddedStudioBridge}){
 const identity=JSON.stringify([workspace.episodeId,workspace.id,scope]);
 const nativeOwner=useMemo(()=>({active:true,sequence:0,provided:undefined as ProductionWorkspace|undefined}),[identity]),activeNativeOwner=useRef(nativeOwner);activeNativeOwner.current=nativeOwner;
 useEffect(()=>{nativeOwner.active=true;return()=>{nativeOwner.active=false;};},[nativeOwner]);
 const review=useCandidateReviewLifecycle({workspace,scope,reader:{...reader,read:async()=>{
  const provided=nativeOwner.provided;nativeOwner.provided=undefined;
  if(bridge)await bridge.save();return provided??reader.read();
 }},
  prepare:async(current,choice:{candidateId:string;durationPolicy:'keep-target'|'use-candidate';restoreNarration:boolean})=>{
   const prepared=await command('prepareWorkspaceCandidate',{episodeId:workspace.episodeId,workspaceId:current.id,expectedRevision:current.revision,candidateId:choice.candidateId,durationPolicy:choice.durationPolicy,...(choice.restoreNarration?{restoreNarration:true}:{})}) as WorkspaceCandidatePreparation;
   if(!prepared.impact||choice.restoreNarration&&!prepared.restoration)throw Error('无法读取采用影响，请刷新后重新核对。');
   return prepared;
  },
  adopt:async(current,plan)=>{
   if(bridge){
    const sequence=nativeOwner.sequence;
    await bridge.applyNativeEdit('apply-candidate',{edit:plan.edit});current=await reader.read();
    if(!nativeOwner.active||activeNativeOwner.current!==nativeOwner||sequence!==nativeOwner.sequence)return current;
   }
   return command('adoptWorkspaceCandidate',{episodeId:workspace.episodeId,workspaceId:current.id,expectedRevision:current.revision,candidateId:plan.candidateId,adoptionId:plan.adoptionId,...(bridge?{nativeApplied:true}:{}),...(plan.restoration?{restoreNarration:true}:{})}) as Promise<ProductionWorkspace>;
  },
 });
 return{...review,cancel:()=>{nativeOwner.sequence++;review.cancel();},prepare:async(candidateId:string,durationPolicy:'keep-target'|'use-candidate'='use-candidate',provided?:ProductionWorkspace,restoreNarration=false)=>{
  nativeOwner.provided=provided;
  try{await review.prepare({candidateId,durationPolicy,restoreNarration});}
  finally{nativeOwner.provided=undefined;}
 }};
}
