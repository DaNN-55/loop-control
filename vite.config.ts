import{defineConfig}from'vite';
import{configDefaults}from'vitest/config';
import react from'@vitejs/plugin-react';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';
import{nativeFrontendBoundary}from'./src/local-app/frontendBoundary';
export default defineConfig(async environment=>{
 const{mode,command}=environment;
 // Shared-view regression fixtures use an explicit non-network contract.
 // Reserve CPU headroom for jsdom; keep Vitest's default per-test timeout.
 // Runtime state and archived evidence contain historical source copies.
 if(mode==='test')return{envFile:false,plugins:[react()],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('contract')},test:{environment:'jsdom',globals:true,setupFiles:['src/ui/dan-ui/test-setup.ts'],maxWorkers:'50%',exclude:[...configDefaults.exclude,'.loop-control/**','.scratch/**','output/**','outputs/**','tmp/**','docs/verification/**']}};
 if(command==='serve'){
  const configPath=pathToFileURL(resolve('scripts/runtime/vite.config.mjs')).href;
  return(await import(/* @vite-ignore */configPath)).default;
 }
 return{envFile:false,envPrefix:'LOOP_LOCAL_PUBLIC_',plugins:[react(),nativeFrontendBoundary(process.cwd())],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')}};
});
