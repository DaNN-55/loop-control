import {relative} from 'node:path';
import type {Plugin} from 'vite';
// New builds have a static native entry and no remotely authenticated client.
export function nativeFrontendBoundary(projectRoot:string):Plugin{
 return{name:'native-runtime-boundary',enforce:'pre',resolveId(source){
  if(source==='@supabase/supabase-js'||source.startsWith('@supabase/'))throw Error('Supabase SDK is outside the native runtime.');
 },generateBundle(){const modules=[...this.getModuleIds()].map(id=>id.split('?')[0]);
  const legacy=modules.filter(id=>/node_modules\/@supabase\//.test(id)||/\/src\/(?:App\.tsx|lib\/supabase\.ts|local-control-plane\/)/.test(id));if(legacy.length)throw Error('Legacy dependency entered native bundle: '+legacy.map(id=>relative(projectRoot,id)).join(', '));
  this.emitFile({type:'asset',fileName:'native-runtime-graph.json',source:JSON.stringify({version:1,entry:'src/local-app/main.tsx',sdkPresent:false,legacyControlPlanePresent:false,modules:[...new Set(modules.map(id=>id.startsWith(projectRoot+'/')?relative(projectRoot,id):id))].sort()},null,2)+'\n'});
 }};
}
