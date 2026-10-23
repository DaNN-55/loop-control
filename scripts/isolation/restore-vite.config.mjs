import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createLocalControlPlaneMiddleware } from '../../src/local-control-plane/middleware';
const enabled=process.env.LOOP_STAGE_B_WORKER==='1';
const bridge=createLocalControlPlaneMiddleware({supabaseUrl:process.env.VITE_SUPABASE_URL,supabasePublishableKey:process.env.VITE_SUPABASE_PUBLISHABLE_KEY},{serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
export default defineConfig({ plugins: [react(), { name:'isolated-recovery-tools', configureServer(server) { server.middlewares.use((req,res,next)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(enabled && path==='/_episode-dispatch')return bridge(req,res,next);
  if(path.startsWith('/_')) {res.statusCode=503;res.end('恢复检查控制台未启用此本机操作。');}else next();
}); } }], server:{watch:{ignored:['**/.loop-control/**','**/n8n/runtime/**','**/outputs/**']}} });
