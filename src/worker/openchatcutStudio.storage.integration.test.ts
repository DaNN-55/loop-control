// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openOpenChatCutDraftStudio,closeOpenChatCutStudio,inspectOpenChatCutStoredProject} from './openchatcutStudio';
import {buildOpenChatCutProject} from './openchatcutProject';
import {confirmedTtsRender} from './openchatcutProject.fixture';
import {editStudioDocument} from '../local-app/studioDocument.fixture';
const sdk=process.env.OPENCHATCUT_ROOT;
it.skipIf(!sdk)('reads the latest offline SQLite edit and opens the exact new LC version instead of reimporting JSON backups',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-studio-sqlite-')),episodeId=randomUUID(),projectId=`loop-control-${episodeId}`,runtime={root:sdk,nodePath:process.execPath};
 const project=buildOpenChatCutProject(confirmedTtsRender(),projectId);
 try{
  const first=await openOpenChatCutDraftStudio(root,episodeId,project,[],'first',runtime);
  await editStudioDocument(first.studioUrl!,projectId,doc=>{doc.timelines[0].name='最新原生修改';});
  await closeOpenChatCutStudio(episodeId);
  expect((await inspectOpenChatCutStoredProject(root,episodeId))!.project.timelines[0].name).toBe('最新原生修改');
  const next=structuredClone(project);next.timelines[0].name='明确采用的新工作版本';
  const reopened=await openOpenChatCutDraftStudio(root,episodeId,next,[],'next',runtime);
  const response=await fetch(new URL(`/api/project-store/entry?key=${encodeURIComponent('project:'+projectId)}`,reopened.studioUrl!),{headers:{'Sec-Fetch-Site':'none'}});
  expect(response.status).toBe(200);expect((await response.json()).value.timelines[0].name).toBe('明确采用的新工作版本');
 }finally{await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},120000);

it.skipIf(!sdk)('recovers the latest SQLite edit for the same workspace baseline after the host exits, despite stale JSON backups',async()=>{
 const {readFile,writeFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'loop-studio-recover-')),episodeId=randomUUID(),projectId=`loop-control-${episodeId}`,runtime={root:sdk,nodePath:process.execPath};
 const project=buildOpenChatCutProject(confirmedTtsRender(),projectId);
 try{
  const first=await openOpenChatCutDraftStudio(root,episodeId,project,[],'same-baseline',runtime);
  await editStudioDocument(first.studioUrl!,projectId,doc=>{doc.timelines[0].name='LATEST_SQLITE_RECOVERY';});
  await closeOpenChatCutStudio(episodeId);
  const legacyPath=join(root,'episodes',episodeId,'openchatcut-work/current/runtime/project-store-v1.json');
  const backup=JSON.parse(await readFile(legacyPath,'utf8'));backup.entries['project:'+projectId].timelines[0].name='STALE_JSON_MUST_NOT_WIN';await writeFile(legacyPath,JSON.stringify(backup));
  expect((await inspectOpenChatCutStoredProject(root,episodeId))!.project.timelines[0].name).toBe('LATEST_SQLITE_RECOVERY');
  const reopened=await openOpenChatCutDraftStudio(root,episodeId,project,[],'same-baseline',runtime);
  const response=await fetch(new URL(`/api/project-store/entry?key=${encodeURIComponent('project:'+projectId)}`,reopened.studioUrl!),{headers:{'Sec-Fetch-Site':'none'}});
  expect(response.status).toBe(200);expect((await response.json()).value.timelines[0].name).toBe('LATEST_SQLITE_RECOVERY');
 }finally{await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},120000);

it.skipIf(!sdk)('preserves both versions instead of overwriting when the native store and host changed since their shared snapshot',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-studio-conflict-')),episodeId=randomUUID(),projectId=`loop-control-${episodeId}`,runtime={root:sdk,nodePath:process.execPath};
 const project=buildOpenChatCutProject(confirmedTtsRender(),projectId);
 try{
  const first=await openOpenChatCutDraftStudio(root,episodeId,project,[],'same-baseline',runtime);
  await editStudioDocument(first.studioUrl!,projectId,doc=>{doc.timelines[0].name='NATIVE_EDIT_RETAINED';});
  await closeOpenChatCutStudio(episodeId);
  const next=structuredClone(project);next.timelines[0].name='HOST_EDIT_RETAINED';
  await expect(openOpenChatCutDraftStudio(root,episodeId,next,[],'same-baseline',runtime)).rejects.toThrow('均有新修改');
  expect((await inspectOpenChatCutStoredProject(root,episodeId))!.project.timelines[0].name).toBe('NATIVE_EDIT_RETAINED');
  expect(next.timelines[0].name).toBe('HOST_EDIT_RETAINED');
 }finally{await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},120000);

it.skipIf(!sdk)('refuses stale JSON when a migrated SQLite database is missing',async()=>{
 const {access}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'loop-studio-missing-sqlite-')),episodeId=randomUUID(),projectId=`loop-control-${episodeId}`,runtime={root:sdk,nodePath:process.execPath};
 const project=buildOpenChatCutProject(confirmedTtsRender(),projectId);
 try{
  const opened=await openOpenChatCutDraftStudio(root,episodeId,project,[],'baseline',runtime);
  await editStudioDocument(opened.studioUrl!,projectId,doc=>{doc.timelines[0].name='ONLY_IN_SQLITE';});
  await closeOpenChatCutStudio(episodeId);
  const path=join(root,'episodes',episodeId,'openchatcut-work/current/runtime/project-store-v1.sqlite3');
  await access(path+'.receipt.json');await rm(path);
  await expect(inspectOpenChatCutStoredProject(root,episodeId)).rejects.toThrow('SQLite 工程文件缺失');
 }finally{await closeOpenChatCutStudio(episodeId);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},120000);
