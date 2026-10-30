import {expect,it} from 'vitest';
import {patchMediaPoolImports} from './openchatcut-media-imports.mjs';
it('rejects unsupported import layouts instead of silently dropping registration guards',()=>{
 expect(()=>patchMediaPoolImports('unknown','/src/media/useEditorMediaIngest.ts')).toThrow('导入接点');
 expect(()=>patchMediaPoolImports('export async function importAssetToPool(file: File,','/src/media/poolImportRun.ts')).toThrow('素材池导入接点');
});
