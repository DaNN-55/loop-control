import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createLocalControlPlaneMiddleware } from '../../src/local-control-plane/middleware';
import { beginTaskDispatch } from '../../src/local-control-plane/routes/handlers';
const run=promisify(execFile);
const enabled=process.env.LOOP_STAGE_B_WORKER==='1';
const bridge=createLocalControlPlaneMiddleware({supabaseUrl:process.env.VITE_SUPABASE_URL,supabasePublishableKey:process.env.VITE_SUPABASE_PUBLISHABLE_KEY},{serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY,dispatchTask:id=>beginTaskDispatch(id,async taskId=>{
  // Deliberately bypass the A shell/worker.env.local. This is the same real Worker,
  // launched with this verified recovery target's clean environment and built code.
  const result=await run(process.execPath,[join(process.cwd(),'dist/worker/worker/codexWorkerCli.js'),'--task-id',taskId],{env:process.env,cwd:process.cwd(),maxBuffer:4*1024*1024});
  console.log(JSON.stringify({stageBWorkerUrl:process.env.SUPABASE_URL,result:result.stdout.trim()}));
})});
export default defineConfig({ plugins: [react(), { name:'isolated-recovery-tools', configureServer(server) { server.middlewares.use((req,res,next)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(enabled && path==='/_episode-dispatch')return bridge(req,res,next);
  if(path.startsWith('/_')) {res.statusCode=503;res.end('恢复检查控制台未启用此本机操作。');}else next();
}); } }], server:{watch:{ignored:['**/.loop-control/**','**/n8n/runtime/**','**/outputs/**']}} });
