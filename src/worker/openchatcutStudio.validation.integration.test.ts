import {productionWorkspaceFixture} from '../local-app/productionWorkspace.fixture';
import type {OpenChatCutProject} from './openchatcutProject';
// @vitest-environment node
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {buildOpenChatCutProject} from './openchatcutProject';
import {confirmedTtsRender} from './openchatcutProject.fixture';
import {inspectOpenChatCutProjectWithRuntime,type OpenChatCutProjectObservation} from './openchatcutProjectReader';
import {closeOpenChatCutStudio,openOpenChatCutDraftStudio} from './openchatcutStudio';
import {validateWorkspaceProject} from '../local-app/productionWorkspaceCommands';

const readDurations=vi.hoisted(()=>[] as number[]);
vi.mock('./openchatcutProjectReader.js',async importOriginal=>{
 const actual=await importOriginal<typeof import('./openchatcutProjectReader')>();
 return {...actual,inspectOpenChatCutProjectWithRuntime:vi.fn(async(...args:Parameters<typeof actual.inspectOpenChatCutProjectWithRuntime>)=>{
  const start=performance.now();
  try{return await actual.inspectOpenChatCutProjectWithRuntime(...args);}
  finally{readDurations.push(Math.round(performance.now()-start));}
 })};
});

const sdk=process.env.OPENCHATCUT_ROOT?.trim();
if(!sdk)throw Error('Studio validation integration requires OPENCHATCUT_ROOT.');

it('retains both validators while reading the identical document once during each draft open',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-control-studio-validation-')),episodeId=randomUUID();
 const runtime={root:sdk,nodePath:process.execPath},project=buildOpenChatCutProject(confirmedTtsRender(),`loop-control-${episodeId}`);
 const reader=vi.mocked(inspectOpenChatCutProjectWithRuntime);reader.mockClear();readDurations.length=0;
 const validate=vi.fn(async(doc:typeof project,observation?:OpenChatCutProjectObservation)=>{
  expect(doc).toEqual(project);
  expect((observation??await inspectOpenChatCutProjectWithRuntime(doc,runtime)).readable).toBe(true);
 });
 const started=performance.now();
 try{
  const opened=await openOpenChatCutDraftStudio(root,episodeId,project,[],'same-input',runtime,validate);
  expect(opened.studioUrl).toContain(`#/editor/loop-control-${episodeId}`);
  console.info(JSON.stringify({name:'draft-open-validation',sdkReads:reader.mock.calls.length,validatorCalls:validate.mock.calls.length,readDurationsMs:[...readDurations],elapsedMs:Math.round(performance.now()-started)}));
  expect(validate).toHaveBeenCalledTimes(2);
  expect(reader).toHaveBeenCalledTimes(1);
  const reopened=await openOpenChatCutDraftStudio(root,episodeId,project,[],'same-input',runtime,validate);
  expect(reopened.studioUrl).toBe(opened.studioUrl);
  expect(validate).toHaveBeenCalledTimes(4);
  expect(reader).toHaveBeenCalledTimes(2);
 }finally{await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},120_000);

it('still rejects a source SHA change at the second validation when SDK evidence is reused',async()=>{
 const f=await productionWorkspaceFixture(),root=f.assetRoot,episodeId=f.episode,runtime=f.runtime;
 try{
  let workspace=(await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script})).body;workspace=await f.fillVisuals(workspace);
  const project=JSON.parse(await readFile(join(root,workspace.project.relativePath),'utf8')) as OpenChatCutProject,paths=[...new Set(project.assets.map(asset=>asset.src))],bytes=await readFile(join(root,paths[0]));
  const query=vi.spyOn(f.c,'query'),reader=vi.mocked(inspectOpenChatCutProjectWithRuntime);reader.mockClear();let checks=0;
  const validate=vi.fn(async(doc:typeof project,observation?:OpenChatCutProjectObservation)=>{
   await validateWorkspaceProject(f.c,root,episodeId,doc,runtime,undefined,observation);
   if(++checks===1)await writeFile(join(root,paths[0]),Buffer.alloc(bytes.length,2));
  });
  await expect(openOpenChatCutDraftStudio(root,episodeId,project,paths,'same-input',runtime,validate)).rejects.toThrow('文件指纹已变化');
  expect(validate).toHaveBeenCalledTimes(2);expect(reader).toHaveBeenCalledTimes(1);expect(query.mock.calls.length).toBeGreaterThan(paths.length);
 }finally{await closeOpenChatCutStudio(episodeId);await f.close();}
},120_000);

it('revalidates a changed native-store document instead of trusting the input fingerprint',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-control-studio-validation-')),episodeId=randomUUID();
 const runtime={root:sdk,nodePath:process.execPath},project=buildOpenChatCutProject(confirmedTtsRender(),`loop-control-${episodeId}`);
 let restoreFetch=()=>{};
 try{
  const opened=await openOpenChatCutDraftStudio(root,episodeId,project,[],'same-input',runtime);
  const nativeFetch=globalThis.fetch,entry=`${new URL(opened.studioUrl!).origin}/api/project-store/entry?`;
  // Inject a newer document at the store-response boundary; keep the real server
  // and SDK reader running, and never write unvalidated edits to its store.
  const fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
   const response=await nativeFetch(input,init);
   if(String(input).startsWith(entry)){
    const payload=await response.json();payload.value.timelines[0].name='new native edit';
    return Response.json(payload,{status:response.status});
   }
   return response;
  });
  restoreFetch=()=>fetchSpy.mockRestore();
  const reader=vi.mocked(inspectOpenChatCutProjectWithRuntime);reader.mockClear();
  const validate=vi.fn(async(doc:typeof project,observation?:OpenChatCutProjectObservation)=>{
   expect((observation??await inspectOpenChatCutProjectWithRuntime(doc,runtime)).readable).toBe(true);
   if(doc.timelines[0].name==='new native edit')throw Error('new document requires validation');
  });
  await expect(openOpenChatCutDraftStudio(root,episodeId,project,[],'same-input',runtime,validate)).rejects.toThrow('new document requires validation');
  expect(validate).toHaveBeenCalledTimes(2);
  expect(reader).toHaveBeenCalledTimes(2);
  expect(validate.mock.calls[1][0].timelines[0].name).toBe('new native edit');
 }finally{restoreFetch();await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},120_000);
