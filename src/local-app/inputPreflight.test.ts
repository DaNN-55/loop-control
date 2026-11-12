// @vitest-environment node
import {it,expect} from 'vitest';
import {blueprintSelectionErrors,createRuntimePreflight} from '../worker/runtimePreflight';
import {createWorkerTaskPackage} from '../worker/contracts';
const policy={executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'configured-model',prompt_version:'storyboard-v1',harness_id:'synthetic-id'}}};
it('ignores retired planner fields while keeping current media Adapter/model/path constraints',()=>{
 expect(blueprintSelectionErrors({})).toEqual([]);
 expect(blueprintSelectionErrors({executors:{storyboard_planning:{}}})).toEqual([]);
 expect(blueprintSelectionErrors(policy)).toEqual([]);
 expect(blueprintSelectionErrors({...policy,b_roll:{execution_path:'manual'}})).toEqual([]);
 expect(blueprintSelectionErrors({...policy,b_roll:{execution_path:'external',executor:{provider:'pexels',adapter:'unknown',model:'pexels-video-v1',prompt_version:'b-roll-v1'},credential_ref:'00000000-0000-4000-8000-000000000000'}})).not.toEqual([]);
 expect(blueprintSelectionErrors({...policy,b_roll:{execution_path:'external',executor:{provider:'pexels',adapter:'pexels_video',model:'unsupported-model',prompt_version:'b-roll-v1'},credential_ref:'00000000-0000-4000-8000-000000000000'}})).not.toEqual([]);
 expect(blueprintSelectionErrors({...policy,b_roll:{executor:{provider:'pexels',adapter:'pexels_video',model:'pexels-video-v1',prompt_version:'b-roll-v1'}}})).not.toEqual([]);
});

it('still blocks a current image Worker without its required write permission',async()=>{
 const taskPackage=createWorkerTaskPackage({task:{id:'image-task',type:'generate_static_visual',attempt:0,budgetLimitCents:0,maxAttempts:1,provider:'openai',model:'gpt-image-2',promptVersion:'static-visual-v1'},episode:{id:'episode',accountId:'account',blueprintVersionId:'blueprint',title:'Permissions'},capability:'static_visual_generation',allowedTools:['read'],allowedAssetRoot:'/tmp/unused',inputArtifacts:[],credentialRef:'00000000-0000-4000-8000-000000000000',media:{adapter:'openai_images',staticVisual:{prompt:'A reference image'}},output:{requiredArtifactTypes:['static_visual'],relativePath:'episodes/episode/image.png',contentType:'image/png',reviewStage:'visual_review'}});
 const preflight=createRuntimePreflight({collect:async({demands})=>demands.map(demand=>({...demand,state:'not_applicable' as const}))});
 const decision=await preflight.inspect({kind:'worker_task',taskPackage});
 expect(decision.passed).toBe(false);
 expect(decision.report.checks).toContainEqual(expect.objectContaining({capability:'static_visual_generation',check:'tool_permission',status:'blocked',scope:'worker'}));
});
