import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({envFile:false,envPrefix:'LOOP_PROTOTYPE_PUBLIC_',publicDir:false,
 plugins:[react(),{name:'owner-settings-preview',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(req.url==='/'||req.url?.startsWith('/?')){res.writeHead(302,{Location:'/src/local-app/owner-settings.prototype.html'});res.end();return;}
  if(req.url?.startsWith('/api/')||req.url?.startsWith('/_local')){res.writeHead(404);res.end('Preview only');return;}next();
 });}}], optimizeDeps:{entries:['src/local-app/owner-settings.prototype.html']},cacheDir:'.scratch/owner-settings-prototype-vite',
 server:{host:'127.0.0.1',port:5201,strictPort:true,open:false,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/.scratch/**']},watch:{ignored:['**/.loop-control/**','**/.scratch/**','**/docs/verification/**']}}});
