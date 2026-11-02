// @vitest-environment node
import {expect,it} from 'vitest';
import {isNativePublicationUnknownMessage,NativePublicationUnknownError} from './workerOutcome';

it('binds an unknown publication message to the exact task and attempt',()=>{
 const task={task_id:'controlled-task',attempt:2},message={code:NativePublicationUnknownError.code,taskId:task.task_id,attempt:task.attempt};
 expect(isNativePublicationUnknownMessage('progress\n'+JSON.stringify(message)+'\n',task)).toBe(true);
 for(const value of [{...message,taskId:'other'}, {...message,attempt:1}, {...message,attempt:'2'}, {...message,code:'ordinary_failure'},null])expect(isNativePublicationUnknownMessage(JSON.stringify(value),task)).toBe(false);
 expect(isNativePublicationUnknownMessage(JSON.stringify(message)+'\ninvalid',task)).toBe(false);
 expect(isNativePublicationUnknownMessage('',task)).toBe(false);
});
