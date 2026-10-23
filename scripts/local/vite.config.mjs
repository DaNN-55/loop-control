import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {configuration,projectRoot,appPort,verifiedSource} from './environment.mjs';
import {createLocalDatabase,readLocalCatalog} from '../../dist/local-app/local-app/catalog.js';
import {createCatalogHandler} from '../../dist/local-app/local-app/catalogRoute.js';
const c=configuration(),source=verifiedSource();
if(source.projectId!=='loop-control-stage-b-verified')throw Error('T12 identity bridge requires verified test source');
const pool=createLocalDatabase(c.database);
const handler=createCatalogHandler({origin:`http://127.0.0.1:${appPort}`,catalog:id=>readLocalCatalog(pool,id),authenticate:async request=>{
 const token=request.headers.authorization;
 if(!token?.startsWith('Bearer ') || token.length>8192)return null;
 const response=await fetch(`${source.apiUrl}/auth/v1/user`,{headers:{apikey:source.anonKey,Authorization:token},signal:AbortSignal.timeout(3000)});
 if(!response.ok)return null;const user=await response.json();return typeof user.id==='string'?user.id:null;
}});
export default defineConfig({root:projectRoot,plugins:[react(),{name:'local-business-backend',configureServer(server){server.middlewares.use((request,response,next)=>{if(request.url?.startsWith('/api/')||request.url?.startsWith('/_'))void handler(request,response);else next();});server.httpServer?.once('close',()=>void pool.end());}}],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local'),'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(source.apiUrl),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(source.anonKey)},server:{host:'127.0.0.1',port:appPort,strictPort:true,fs:{strict:true,deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.loop-control/**','**/n8n/worker.env*']},watch:{ignored:['**/.loop-control/**']}}});
