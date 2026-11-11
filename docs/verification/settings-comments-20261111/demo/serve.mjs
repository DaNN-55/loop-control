import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:'.scratch/settings-review-v2-preview',plugins:[react()],optimizeDeps:{entries:['src/local-app/settings-review-v2.prototype.html']},server:{host:'127.0.0.1',port:5210,strictPort:true,fs:{deny:['.env','.env.*','**/.loop-control/**','**/.git/**']},watch:{ignored:['**/.loop-control/**','**/cache/**']}}});
await server.listen();console.log('http://127.0.0.1:5210/src/local-app/settings-review-v2.prototype.html?variant=balanced');
