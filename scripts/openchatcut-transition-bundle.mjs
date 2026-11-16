import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {cp,readFile} from 'node:fs/promises';
import {patchTransitionPlacement} from './openchatcut-transition-placement.mjs';

/** Same pinned Remotion entry and assets, with the host's GL placement adapter. */
export async function buildTransitionRenderBundle(root,outDir){
 patchTransitionPlacement(await readFile(join(root,'src/gl/GlTransition.tsx'),'utf8'));
 const require=createRequire(join(root,'package.json'));
 const {bundle}=await import(pathToFileURL(require.resolve('@remotion/bundler')).href);
 const loader=fileURLToPath(new URL('./openchatcut-transition-loader.cjs',import.meta.url));
 const url=await bundle({entryPoint:join(root,'remotion/index.ts'),publicDir:join(root,'assets'),outDir,webpackOverride:config=>({...config,resolve:{...config.resolve,extensionAlias:{...config.resolve?.extensionAlias,'.js':['.js','.ts','.tsx']}},module:{...config.module,rules:[...(config.module?.rules??[]),{test:/\.frag$/,type:'asset/source'},{test:/[/\\]src[/\\]gl[/\\]GlTransition\.tsx$/,enforce:'pre',use:[loader]}]}})});
 await cp(join(root,'assets'),url,{recursive:true});return url;
}
