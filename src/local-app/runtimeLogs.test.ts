// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm,symlink,readFile,stat,mkdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {once} from 'node:events';
import type {Pool} from 'pg';
import {readRuntimeLogs,redactRuntimeLog} from './runtimeLogs';
import {createLocalHandler} from './localRoute';
import {csrfFor} from './sessions';

it('reads genuine file blocks, preserves missing metadata and redacts before returning records',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-logs-')));
 try{
  const file=join(root,'app.log');await writeFile(file,'[vite] hmr update /not-an-event\nError: Connection terminated unexpectedly\n    at Connection (/Users/example/private/node_modules/pg/lib/client.js:1:2)\n'+JSON.stringify({time:'2026-11-11T01:00:00Z',level:'INFO',message:'request accepted',operationId:'op-1',requestId:'req-1',episodeId:'ep-1',authorization:'private-value',scriptContent:'private-script'})+'\n');
  const report=await readRuntimeLogs([file]);expect(report.entries).toHaveLength(2);expect(report.entries[1].occurredAt).toBeNull();expect(report.entries[1].episodeId).toBeNull();expect(report.entries[1].operationId).toBeNull();expect(report.entries[1].explanation.what).toContain('PostgreSQL');expect(report.entries[1].raw).toContain('[项目目录]');expect(report.entries[1].line).toBe(2);
  expect(report.entries[0].operationId).toBe('op-1');expect(JSON.stringify(report)).not.toMatch(/private-value|private-script|\/Users\/example/);
  expect(redactRuntimeLog('Error: Authorization: Bearer abcdefg token=private-token https://user:private-pass@example.invalid/output?signature=private-signature')).not.toMatch(/abcdefg|private-token|private-pass|private-signature/);
  expect((await readRuntimeLogs([join(root,'missing.log')])).sourceAvailable).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('bounds file tail, record count and raw size, and refuses symlink reads',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-logs-limits-')));
 try{
  const file=join(root,'app.log');await writeFile(file,'x'.repeat(1100000)+'\n'+Array.from({length:250},(_,i)=>`Error: item ${i}\n`).join(''));const r=await readRuntimeLogs([file]);expect(r.truncated).toBe(true);expect(r.entries).toHaveLength(200);expect(r.entries[0].message).toContain('249');expect(r.entries[0].line).toBeNull();
  const link=join(root,'link.log');await symlink(file,link);await expect(readRuntimeLogs([link])).rejects.toThrow('暂不可读');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('persists log location atomically without changing active file, rejects symlinks, falls back when removed',async()=>{
 const mod=await import(pathToFileURL(join(process.cwd(),'scripts/runtime/log-storage.mjs')).href);
 const root=await realpath(await mkdtemp(join(tmpdir(),'loop-log-settings-')));
 try{
  const target=join(root,'chosen');await mkdir(target,{mode:0o700});const active=join(root,'app-private.log'),service=mod.createLogStorage(root,active);expect(service.read().pending).toBe(false);const saved=service.save(target);expect(saved.pending).toBe(true);expect(saved.activeDirectory).toBe(root);expect(mod.runtimeLogBinding(root).file).toBe(join(target,'loop-control-runtime.log'));
  expect((await stat(join(root,'log-storage.json'))).mode&0o077).toBe(0);expect(JSON.parse(await readFile(join(root,'log-storage.json'),'utf8')).directory).toBe(target);
  const alias=join(root,'alias');await symlink(target,alias);expect(()=>service.save(alias)).toThrow();await rm(target,{recursive:true});expect(mod.runtimeLogBinding(root).file).toBe(active);expect(service.read().warning).toContain('默认');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('uses real HTTP and file IO behind Owner, origin and CSRF checks; does not accept arbitrary paths',async()=>{
 const mod=await import(pathToFileURL(join(process.cwd(),'scripts/runtime/log-storage.mjs')).href),root=await realpath(await mkdtemp(join(tmpdir(),'loop-log-http-')));
 const token='a'.repeat(64),pool={query:async()=>({rows:[{id:'owner',email:'owner@example.invalid'}]})} as unknown as Pool;
 let handler:ReturnType<typeof createLocalHandler>;const server=createServer((q,r)=>handler(q,r));server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 try{
  const file=join(root,'app-private.log');await writeFile(file,'Error: Connection terminated unexpectedly\n',{mode:0o600});handler=createLocalHandler({pool,origin,mediaRoot:'/unused',logs:{read:()=>readRuntimeLogs([file]),storage:mod.createLogStorage(root,file)}});
  const headers={Cookie:'loop_owner_session='+token};const get=(suffix:string,extra={})=>fetch(origin+'/api/local/'+suffix,{headers:{...headers,...extra}});
  expect((await fetch(origin+'/api/local/logs')).status).toBe(401);expect((await get('logs',{Origin:'https://other.invalid'})).status).toBe(403);expect((await get('logs?path=/etc/passwd')).status).toBe(400);
  const response=await get('logs');expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect((await response.json()).entries).toHaveLength(1);
  const body=JSON.stringify({command:'save',path:root});const post=(csrf:string)=>fetch(origin+'/api/local/log-storage',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body});expect((await post('bad')).status).toBe(403);expect((await post(csrfFor(token))).status).toBe(200);
  expect((await get('log-storage')).status).toBe(200);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
