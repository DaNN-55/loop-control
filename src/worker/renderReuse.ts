import{createHash}from'node:crypto';
import{readFile}from'node:fs/promises';
import type{ArtifactManifest,WorkerTaskPackage}from'./contracts.js';
import type{OpenChatCutProject}from'./openchatcutProject.js';
import{safeAssetOutputPath,writeSafeAssetFile}from'./controlledMediaExecutor.js';
type ReviewRender=NonNullable<WorkerTaskPackage['reviewRender']>;
export interface ApprovedRenderSource{reviewPackageId:string;inputsMatch:boolean;video:ArtifactManifest|null}
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
export function renderInputFingerprint(render:ReviewRender,project:OpenChatCutProject,model:string):string{
 // Includes actual frozen Studio state, trims, audio mixing, captions and exports.
 return createHash('sha256').update(canonical({version:'openchatcut-render-input/v1',model,exportContract:'scripts/openchatcut-render/v1',render,project})).digest('hex');
}
async function verifiedFile(root:string,manifest:ArtifactManifest):Promise<Buffer>{
 const bytes=await readFile(await safeAssetOutputPath(root,manifest.relativePath));
 if(bytes.length!==manifest.fileSize||createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('Reuse candidate integrity mismatch');
 return bytes;
}
export async function tryReuseRender(input:{root:string;finalRender:NonNullable<WorkerTaskPackage['finalRender']>;source:ApprovedRenderSource;project:OpenChatCutProject;fingerprint:string;model:string;outputRelativePath:string}):Promise<boolean>{
 const{source,finalRender}=input;
 if(!source.inputsMatch||source.reviewPackageId!==finalRender.sourceReviewPackageId||!source.video||source.video.relativePath===input.outputRelativePath)return false;
 try{
  const project=JSON.parse((await verifiedFile(input.root,finalRender.sourceProject)).toString('utf8'));
  const runtime=JSON.parse((await verifiedFile(input.root,finalRender.sourceRuntime)).toString('utf8'));
  const qc=JSON.parse((await verifiedFile(input.root,finalRender.sourceQcReport)).toString('utf8'));
  if(canonical(project)!==canonical(input.project)||runtime.name!=='OpenChatCut'||input.model!==`openchatcut@${runtime.version}`||qc.passed!==true||qc.renderFingerprint!==input.fingerprint||qc.output?.relativePath!==source.video.relativePath)return false;
  const video=await verifiedFile(input.root,source.video);
  await writeSafeAssetFile(input.root,input.outputRelativePath,video);
  return true;
 }catch{return false;}
}
