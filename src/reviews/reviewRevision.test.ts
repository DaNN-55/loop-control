import {expect,it} from 'vitest';
import {studioWorkspaceFromPayload} from './reviewRevision';
it('still decodes historical Studio workspace references without executing them',()=>{
 expect(studioWorkspaceFromPayload({relativePath:'original/project.json',sha256:'a'.repeat(64),fileSize:123,projectId:'retained'})).toEqual({relativePath:'original/project.json',sha256:'a'.repeat(64),fileSize:123,projectId:'retained'});
 for(const value of [null,[],{}, {relativePath:'original.json',sha256:'a',fileSize:'123'}])expect(()=>studioWorkspaceFromPayload(value)).toThrow('Studio 工作区响应无效');
});
