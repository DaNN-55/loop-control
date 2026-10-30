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
