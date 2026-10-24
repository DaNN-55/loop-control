import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { startLocalWorkerService } from '../../src/local-control-plane/workerService';
import { serveSystemStatus } from '../../src/local-control-plane/routes/handlers';
import { createLocalControlPlaneMiddleware } from '../../src/local-control-plane/middleware';
let worker;
const enabled=process.env.LOOP_STAGE_B_WORKER==='1';
const observing=process.env.LOOP_STAGE_C_OBSERVE==='1' && process.env.VITE_SUPABASE_URL==='http://127.0.0.1:55461' && !enabled;
const status=serveSystemStatus(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const bridge=createLocalControlPlaneMiddleware({supabaseUrl:process.env.VITE_SUPABASE_URL,supabasePublishableKey:process.env.VITE_SUPABASE_PUBLISHABLE_KEY},{serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
export default defineConfig({ plugins: [react(), { name:'isolated-recovery-tools', async closeBundle(){await worker?.stop();}, async configureServer(server) { worker=enabled ? await startLocalWorkerService(process.env.VITE_SUPABASE_URL) : undefined; server.httpServer?.once('close',()=>{void worker?.stop();}); server.middlewares.use((req,res,next)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(observing && path==='/_system-status')return status(req,res);
  if(enabled && ['/_episode-dispatch','/_worker-preflight'].includes(path))return bridge(req,res,next);
  if(path.startsWith('/_')) {res.statusCode=503;res.end('恢复检查控制台未启用此本机操作。');}else next();
}); } }], server:{watch:{ignored:['**/.loop-control/**','**/n8n/runtime/**','**/outputs/**']}} });
