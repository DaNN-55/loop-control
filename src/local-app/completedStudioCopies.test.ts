// @vitest-environment node
import {expect,it} from 'vitest';
import {completedProjectSources} from './completedStudioCopies';
import {completedCopyDocumentKey} from './completedStudioCopy';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
it('tracks sources beyond timeline clips and ignores navigation selections when checking changes',()=>{
 const project={assets:[{src:'unused.png',originalFilePath:'/original.png'}],timelines:[{selectedId:'a',items:[{src:'used.mp4'},{src:'used.mp4'}]}]} as unknown as OpenChatCutProject;
 expect(completedProjectSources(project)).toEqual(['unused.png','used.mp4']);
 const next=structuredClone(project);next.timelines[0].selectedId=null;
 expect(completedCopyDocumentKey(next)).toBe(completedCopyDocumentKey(project));
 next.timelines[0].width=720;expect(completedCopyDocumentKey(next)).not.toBe(completedCopyDocumentKey(project));
});
