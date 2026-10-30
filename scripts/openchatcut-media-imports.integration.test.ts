// @vitest-environment node
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {transform} from 'esbuild';
import {expect,it,vi} from 'vitest';
import {patchMediaPoolImports} from './openchatcut-media-imports.mjs';
const root=process.env.OPENCHATCUT_ROOT;
if(!root)throw Error('Media import integration requires OPENCHATCUT_ROOT.');
it('redirects the actual SDK pool import before conflict prompts or any placeholder mutation',async()=>{
 const hookPath=join(root,'src/media/useEditorMediaIngest.ts'),hook=await readFile(hookPath,'utf8');
 const patchedHook=patchMediaPoolImports(hook,hookPath);
 expect(patchedHook).toContain('redirectLoopControlImport(asset.kind)');
 const poolPath=hook.includes("from './poolImportRun'")?join(root,'src/media/poolImportRun.ts'):hookPath;
 const patched=poolPath===hookPath?patchedHook:patchMediaPoolImports(await readFile(poolPath,'utf8'),poolPath);
 const start=patched.indexOf('async function importAssetToPool('),end=patched.indexOf('\n}',start)+2;
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const {code}=await transform(patched.slice(start,end),{loader:'ts'});
 const redirect=vi.fn(()=>{throw Error('use registered Host import');}),conflict=vi.fn(),confirm=vi.fn(),addAsset=vi.fn();
 const actualImport=new Function('redirectLoopControlImport','findMediaNameConflict','window',code+';return importAssetToPool;')(redirect,conflict,{confirm});
 await expect(actualImport({type:'video/mp4',name:'already-exists.mp4'},undefined,undefined,{stateRef:{current:{assets:[]}},commands:{addAsset}},vi.fn())).rejects.toThrow('use registered Host import');
 expect(redirect).toHaveBeenCalledWith('video/mp4');expect(conflict).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();expect(addAsset).not.toHaveBeenCalled();
});
