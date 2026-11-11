// Independent preview: never loaded by the application entry or production build.
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins:[react(),{
    name:'logs-preview-entry',
    configureServer(server){server.middlewares.use((req,res,next)=>{
      if(req.url==='/'||req.url?.startsWith('/?')){res.statusCode=302;res.setHeader('Location','/src/local-app/logs.prototype.html');res.end();return;}
      if(req.url?.startsWith('/api/')){res.statusCode=404;res.end('Preview only');return;}
      next();
    });},
  }], envFile:false, envPrefix:'LOOP_PROTOTYPE_PUBLIC_', publicDir:false,
  optimizeDeps:{entries:['src/local-app/logs.prototype.html']},
  cacheDir:'.scratch/logs-prototype-vite',
  server:{host:'127.0.0.1',port:5199,strictPort:true,open:false,
    fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/.scratch/**']},
    watch:{ignored:['**/.loop-control/**','**/.scratch/**','**/docs/verification/**']},
  },
});
