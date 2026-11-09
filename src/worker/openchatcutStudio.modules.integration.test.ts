// @vitest-environment node
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';
import {buildOpenChatCutProject} from './openchatcutProject';
import {confirmedTtsRender} from './openchatcutProject.fixture';
import {closeOpenChatCutStudio,openOpenChatCutDraftStudio} from './openchatcutStudio';
const sdk=process.env.OPENCHATCUT_ROOT?.trim();
it.skipIf(!sdk)('serves the real embedded editor virtual-module dependency graph without import resolution failures',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-editor-modules-'))),episodeId=randomUUID();
 try{
  const project=buildOpenChatCutProject(confirmedTtsRender(),`loop-control-${episodeId}`),path=project.assets.find(a=>a.kind==='audio')!.src;
  await mkdir(dirname(join(root,path)),{recursive:true});await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-y',join(root,path)]);
  const session=await openOpenChatCutDraftStudio(root,episodeId,project,[path],'module-repro',{root:sdk,nodePath:process.execPath});
  const pending=['/src/Editor.tsx','/src/editor/useEditorController.tsx','/src/captions/CaptionPreviewEditor.tsx','/src/captions/captionPreviewTarget.ts','/src/components/inspector/CaptionInspectorControls.tsx','/src/agent/useExternalAgentBridge.ts'],seen=new Set<string>();
  while(pending.length){const path=pending.shift()!;if(seen.has(path))continue;seen.add(path);const response=await fetch(new URL(path,session.studioUrl));const body=await response.text();expect(response.status,`${path}: ${body.slice(0,1800)}`).toBe(200);for(const match of body.matchAll(/["'](\/@id\/__x00__loop-control-[^"']+)["']/g))if(!seen.has(match[1]))pending.push(match[1]);}
  expect([...seen].filter(path=>path.startsWith('/@id/')).sort()).toEqual([
   'audio','bridge-retry','candidates','caption-drag','caption-layout','captions',
   'composition','embed','ranges','shot-captions','structure','video-sound',
  ].map(name=>'/@id/__x00__loop-control-'+name).sort());
 }finally{await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},120_000);
