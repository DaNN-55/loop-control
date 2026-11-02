import {useEffect,useMemo,useRef,useState} from 'react';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {WorkspaceCandidatePreparation} from '../workspaceCandidates';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
import type {WorkspaceReading} from './useWorkspaceReading';
/** Both speech entry points show the authoritative impact before applying a native edit. */
export function useWorkspaceCandidateReview({workspace,scope,reader,command,bridge}:{workspace:ProductionWorkspace;scope:string;reader:WorkspaceReading;command:(name:string,data:unknown)=>Promise<unknown>;bridge?:EmbeddedStudioBridge}){
 const identity=JSON.stringify([workspace.episodeId,workspace.id,scope]),owner=useMemo(()=>({active:true}),[identity]),active=useRef(owner);active.current=owner;
 const [review,setReview]=useState<{owner:typeof owner;plan:WorkspaceCandidatePreparation}|null>(null);
 useEffect(()=>{owner.active=true;return()=>{owner.active=false;};},[owner]);
 const ownsReview=()=>owner.active&&active.current===owner;
 const plan=review?.owner===owner?review.plan:null;
 async function prepare(candidateId:string,durationPolicy:'keep-target'|'use-candidate',provided?:ProductionWorkspace){
  if(bridge)await bridge.save();const current=provided??await reader.read();
  if(!ownsReview())return;
  const prepared=await command('prepareWorkspaceCandidate',{episodeId:workspace.episodeId,workspaceId:current.id,expectedRevision:current.revision,candidateId,durationPolicy}) as WorkspaceCandidatePreparation;
  if(!prepared.impact)throw Error('无法读取采用影响，请刷新后重新核对。');
  if(ownsReview())setReview({owner,plan:prepared});
 }
 async function confirm(){
  if(!plan||!ownsReview())return;
  if(bridge)await bridge.save();let current=await reader.read();
  if(!ownsReview())return;
  setReview(null);
  if(current.project?.sha256!==plan.projectSha256)throw Error('工程已变化，请重新核对采用影响。');
  if(bridge){await bridge.applyNativeEdit('apply-candidate',{edit:plan.edit});current=await reader.read();}
  if(!ownsReview())return;
  const changed=await command('adoptWorkspaceCandidate',{episodeId:workspace.episodeId,workspaceId:current.id,expectedRevision:current.revision,candidateId:plan.candidateId,adoptionId:plan.adoptionId,...(bridge?{nativeApplied:true}:{})}) as ProductionWorkspace;if(ownsReview())reader.publish(changed);
 }
 return {plan,prepare,confirm,cancel:()=>setReview(null)};
}
