// @vitest-environment node
import {it,expect} from 'vitest';
import {projectWorkspaceTaskRetry} from './workspaceTaskRetry';
import {workspaceTaskPresentation} from '../workspaceTaskPresentation';
it('48/46: persisted backoff cannot offer a duplicate retry',()=>{
 const task=projectWorkspaceTaskRetry({status:'ready',attempt:1,maxAttempts:3,retryAt:'2026-11-11T10:00:00Z'},Date.parse('2026-11-11T09:59:00Z'));
 expect(task.waitingForRetry).toBe(true);expect(workspaceTaskPresentation(task)).toMatchObject({state:'retry-wait',canRetry:false,canResume:false});
});
it('48/46: automatic exhaustion does not revoke a new explicit Owner intention',()=>{
 const task=projectWorkspaceTaskRetry({status:'failed',attempt:1,maxAttempts:1});
 expect(task.automaticRetryExhausted).toBe(true);expect(workspaceTaskPresentation(task).canRetry).toBe(true);
 expect(workspaceTaskPresentation({...task,submissionUnknown:true}).canRetry).toBe(false);
 expect(workspaceTaskPresentation({...task,publicationAttempt:0}).canRetry).toBe(false);
});
it('48/46: invalidated input cannot retry or resume, while unknown evidence remains visible',()=>{
 const task=projectWorkspaceTaskRetry({status:'failed',attempt:1,maxAttempts:3,invalidatedAt:new Date()});
 expect(workspaceTaskPresentation({...task,canResume:true})).toMatchObject({state:'superseded',canRetry:false,canResume:false});
 expect(workspaceTaskPresentation({...task,submissionUnknown:true})).toMatchObject({unknown:true,state:'submission-unknown',canRetry:false});
});
