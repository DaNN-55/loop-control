/** Preserve the Host registration boundary across the supported SDK import layouts. */
export function patchMediaPoolImports(code,path){
 const conflict='  const existing = findMediaNameConflict(';
 if(path.endsWith('/src/media/poolImportRun.ts')){
  if(!code.includes('export async function importAssetToPool(file: File,')||!code.includes(conflict))throw Error('当前 Studio 缺少受控素材池导入接点。');
  return "import {redirectLoopControlImport} from 'virtual:loop-control-embed';\n"+code.replace(conflict,'  redirectLoopControlImport(file.type);\n'+conflict);
 }
 const legacy='  const ingestToPool = useCallback((asset: MediaAsset) => {';
 const current='  const ingestToPool = useCallback((asset: MediaAsset, durationFps?: number) => {';
 const anchor=code.includes(legacy)?legacy:code.includes(current)?current:null;
 if(!anchor)throw Error('当前 Studio 缺少受控素材导入接点。');
 if(anchor===legacy){
  if(!code.includes(conflict))throw Error('当前Studio缺少受控同名素材导入接点。');
  code=code.replace(conflict,'  redirectLoopControlImport(file.type);\n'+conflict);
 }else if(!code.includes("from './poolImportRun'"))throw Error('当前 Studio 缺少受控素材池委派接点。');
 return "import {redirectLoopControlImport} from 'virtual:loop-control-embed';\n"+code.replace(anchor,anchor+'\n    redirectLoopControlImport(asset.kind);');
}
