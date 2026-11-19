// @vitest-environment node
import {readFile} from 'node:fs/promises';
import {transformWithEsbuild} from 'vite';
import {expect,it} from 'vitest';
import {patchAgentModels} from './openchatcut-agent-models.mjs';
it('keeps native model selection intact without host connections',()=>{expect(patchAgentModels('native',{})).toBe('native');expect(()=>patchAgentModels('changed',{openai:['enabled']})).toThrow('接入点');});
it.skipIf(!process.env.OPENCHATCUT_ROOT)('adds every enabled host model to the real SDK selector and compiles it',async()=>{
 const source=await readFile(process.env.OPENCHATCUT_ROOT+'/src/agent/model-selection.ts','utf8');const result=patchAgentModels(source,{openai:['gpt-5.6-luna','gpt-5.6-terra']});expect(result).toContain('gpt-5.6-terra');expect(result).toContain("modelId:model");expect((await transformWithEsbuild(result,'model-selection.ts',{loader:'ts'})).code).toContain('loopHostModels');
});
