import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {join} from 'node:path';
import {configuration,projectRoot,appPort,root} from './environment.mjs';
import {createLocalDatabase} from '../../dist/local-app/local-app/catalog.js';
import {createLocalHandler} from '../../dist/local-app/local-app/localRoute.js';
const pool=createLocalDatabase(configuration().database);
const handler=createLocalHandler({origin:`http://127.0.0.1:${appPort}`,pool,mediaRoot:join(root,'media')});
export default defineConfig({root:projectRoot,plugins:[react(),{name:'local-business-backend',configureServer(server){server.middlewares.use((request,response,next)=>{if(request.url?.startsWith('/api/')||request.url?.startsWith('/_'))void handler(request,response);else next();});server.httpServer?.once('close',()=>void pool.end());}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},server:{host:'127.0.0.1',port:appPort,strictPort:true,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/n8n/worker.env*']},watch:{ignored:['**/.loop-control/**']}}});
