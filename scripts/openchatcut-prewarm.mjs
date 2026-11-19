import {prepareStudioProgram,pruneStudioProgramCache} from './openchatcut-program-cache.mjs';
const sdkRoot=process.env.OPENCHATCUT_ROOT,cacheRoot=process.env.LOOP_OPENCHATCUT_PROGRAM_CACHE_DIR;
if(sdkRoot&&cacheRoot){
 const program=await prepareStudioProgram({sdkRoot,cacheRoot});
 await program.release();
 await pruneStudioProgramCache(cacheRoot);
}
