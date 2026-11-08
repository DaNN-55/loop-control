import {inspectWorkspaceVisualFile} from './workspaceVisualMedia.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {MediaFetcher} from '../worker/mediaProviders.js';
import {generateOpenAiImages} from '../worker/mediaProviders.js';
import {writeSafeAssetFile} from '../worker/controlledMediaExecutor.js';
import type {WorkerTaskPackage} from '../worker/contracts.js';
import {isImageGenerationSettings} from '../imageGeneration.js';
import type {NativeAttemptFence} from './nativeAttemptOutput.js';
import {isDefiniteProviderRejection} from '../worker/providerOutcome.js';

export async function executeWorkspaceImages(pool:Pool,p:WorkerTaskPackage,fence:NativeAttemptFence,secret:string,createFetcher:(reserve:()=>Promise<void>)=>MediaFetcher){
  if(p.media?.adapter!=='openai_images'||!isImageGenerationSettings(p.media.staticVisual.settings))throw Error('冻结图片设置无效。');
  const image=p.media.staticVisual;
  const references=await Promise.all((image.references??[]).map(async ref=>({mimeType:ref.mimeType,bytes:await readFile(join(p.assets.allowedRoot,ref.relativePath))})));
  const fetcher=createFetcher(async()=>{await pool.query('SELECT local_identity.reserve_workspace_images($1,$2,$3)',[fence.p_task_id,fence.p_attempt,fence.p_lease_token]);});
  const observe:MediaFetcher=async(url,init)=>{const response=await fetcher(url,init);if(isDefiniteProviderRejection(response.status))await pool.query('SELECT local_identity.record_workspace_visual_submission($1,$2,$3,$4)',[fence.p_task_id,fence.p_attempt,fence.p_lease_token,'rejected']);return response;};
  const images=await generateOpenAiImages({apiKey:secret,fetcher:observe,model:p.model,prompt:image.prompt,settings:image.settings,references});
  await pool.query('SELECT local_identity.record_workspace_visual_submission($1,$2,$3,$4)',[fence.p_task_id,fence.p_attempt,fence.p_lease_token,'received']);
  const artifacts=[];
  for(const [index,bytes]of images.entries()){
    const relativePath=index?p.output.relativePath.replace(/\.png$/,`-${index+1}.png`):p.output.relativePath;
    await writeSafeAssetFile(p.assets.allowedRoot,relativePath,bytes);
    await inspectWorkspaceVisualFile(p.assets.allowedRoot,relativePath,'image');
    artifacts.push({artifactType:'static_visual',relativePath,sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length});
  }
  return JSON.stringify({version:'worker-result/v1',taskId:p.task.id,status:'completed',artifacts,validation:{passed:true,checks:[{name:'image_batch',passed:true,detail:'图片数量、PNG 数据及冻结参考图已校验。'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'Completed'},nextStep:'等待手动选择图片。'});
}
