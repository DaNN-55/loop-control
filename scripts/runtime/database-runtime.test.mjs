// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDatabaseRuntime,validateNativePostgres,databaseOperations} from './database-runtime.mjs';
let root,p,deployment,exec,spawn,runtime,clients,identity,owner;
const identifier='7542380466584442201';
const pidRecord=()=>`12345\n${p.dataDirectory}\n1700000000\n${p.port}\n${p.socketDirectory}\n127.0.0.1\n0 0\nready   \n`;
beforeEach(()=>{
 root=realpathSync(mkdtempSync(join(tmpdir(),'loop-pg-runtime-')));
 for(const path of ['postgres','postgres/data','postgres/socket','bin'])mkdirSync(join(root,path),{mode:0o700});
 p={kind:'native',binDirectory:join(root,'bin'),dataDirectory:join(root,'postgres/data'),socketDirectory:join(root,'postgres/socket'),systemIdentifier:identifier,majorVersion:17,port:55431,adminUser:'postgres'};
 for(const tool of ['postgres','pg_ctl','pg_controldata','psql','pg_dump','pg_restore'])writeFileSync(join(p.binDirectory,tool),'fixture',{mode:0o700});
 writeFileSync(join(p.dataDirectory,'PG_VERSION'),'17\n',{mode:0o600});writeFileSync(join(p.dataDirectory,'postmaster.pid'),pidRecord(),{mode:0o600});
 deployment={home:root,postgres:p,database:{database:'loop_control'}};clients=0;owner=process.getuid();identity={systemIdentifier:identifier,dataDirectory:p.dataDirectory,port:p.port,listenAddresses:'127.0.0.1',majorVersion:17,role:'postgres'};
 exec=vi.fn((file,args,options)=>{
  if(args[0]==='--version')return 'fixture (PostgreSQL) 17.11\n';
  if(file.endsWith('/pg_controldata'))return `Database system identifier: ${identifier}\n`;
  if(file==='/bin/ps')return args.at(-1)==='uid='?String(owner):join(p.binDirectory,'postgres');
  if(file==='/usr/sbin/lsof')return `p12345\nn127.0.0.1:${p.port}\n`;
  if(file.endsWith('/psql')){if(options.input.includes('pg_control_system'))return JSON.stringify(identity);if(options.input.includes('pg_stat_activity'))return String(clients);return 'sql-result\n';}
  if(file.endsWith('/pg_ctl'))return 'ok';
  return 'archive-result';
 });spawn=vi.fn(()=>({fixture:true}));runtime=createDatabaseRuntime(deployment,{projectRoot:'/fixture/project',root,operations:{execFileSync:exec,spawn}});
});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
it('constructs native operations without reading secrets, invoking Docker or starting services',()=>{
 expect(exec).not.toHaveBeenCalled();expect(runtime.nativeConnection).toEqual({host:p.socketDirectory,port:p.port});expect(runtime.docker).toBeUndefined();
 expect(runtime.sql('SELECT 1')).toBe('sql-result');expect(exec.mock.calls.every(([file])=>file!=='docker'&&file!=='colima')).toBe(true);
 const call=exec.mock.calls.at(-1);expect(call[0]).toBe(join(p.binDirectory,'psql'));expect(call[1]).toEqual(['-h',p.socketDirectory,'-p','55431','-U','postgres','--no-password','-XqAt','-d','loop_control','-v','ON_ERROR_STOP=1']);expect(call[2].env.PGPASSFILE).toBe('/dev/null');expect(call[2].env.PGPASSWORD).toBeUndefined();
});
it('uses the same explicit native tools for dump, restore decoding and snapshot holding',()=>{
 const archive=Buffer.from('custom archive');expect(runtime.execTool('pg_restore',['--file=-'],archive)).toBe('archive-result');expect(exec.mock.calls.at(-1)[2].input).toBe(archive);
 runtime.execTool('pg_dump',['-d','loop_control','-Fc'],undefined,{stdio:['ignore',55,'pipe']});expect(exec.mock.calls.at(-1)[2].stdio).toEqual(['ignore',55,'pipe']);
 runtime.spawnTool('psql',['-XqAt','-d','loop_control']);expect(spawn).toHaveBeenCalledWith(join(p.binDirectory,'psql'),expect.arrayContaining(['-h',p.socketDirectory,'-d','loop_control']),expect.objectContaining({stdio:['pipe','pipe','pipe']}));
});
it.each(['systemIdentifier','dataDirectory','port','listenAddresses','majorVersion','role'])('rejects a different live PostgreSQL %s before the requested SQL',field=>{
 identity[field]=typeof identity[field]==='number'?0:'foreign';expect(()=>runtime.sql('SELECT sensitive_business_data')).toThrow('live database identity mismatch');expect(exec.mock.calls.some(([, ,o])=>o.input==='SELECT sensitive_business_data')).toBe(false);
});
it('rejects the wrong process owner, stale process record and wrong binary major',()=>{
 owner++;expect(()=>runtime.assertDatabase()).toThrow('owner or binary');owner=process.getuid();writeFileSync(join(p.dataDirectory,'postmaster.pid'),pidRecord().replace('127.0.0.1','*'));expect(()=>runtime.assertDatabase()).toThrow('process record identity');writeFileSync(join(p.dataDirectory,'postmaster.pid'),pidRecord());exec.mockImplementation(()=> 'fixture (PostgreSQL) 18.0');expect(()=>runtime.assertDatabase()).toThrow('binary major');
});
it('refuses a configured data directory outside the project-specific cluster',()=>{expect(()=>validateNativePostgres({...p,dataDirectory:join(root,'other')},root)).toThrow('configuration mismatch');expect(()=>runtime.sql('select 1','postgres; DROP DATABASE loop_control')).toThrow('Invalid database');});
it('does not start over a stale PID file or an occupied TCP port',()=>{
 writeFileSync(join(p.dataDirectory,'postmaster.pid'),'999\nforeign\n');expect(()=>runtime.ensureStarted()).toThrow('process record identity');expect(exec.mock.calls.some(([,a])=>a.includes('start'))).toBe(false);
 unlinkSync(join(p.dataDirectory,'postmaster.pid'));expect(()=>runtime.ensureStarted()).toThrow('already occupied');expect(exec.mock.calls.some(([,a])=>a.includes('start'))).toBe(false);
});
it('starts only its configured cluster and confirms the resulting live identity',()=>{
 unlinkSync(join(p.dataDirectory,'postmaster.pid'));const original=exec.getMockImplementation();exec.mockImplementation((file,args,options)=>{if(file==='/usr/sbin/lsof'&&!args.includes('-a'))throw Object.assign(Error('empty'),{status:1,stdout:'',stderr:''});if(file.endsWith('/pg_ctl')&&args.includes('start'))writeFileSync(join(p.dataDirectory,'postmaster.pid'),pidRecord(),{mode:0o600});return original(file,args,options);});runtime.ensureStarted();expect(exec.mock.calls.filter(([,a])=>a.includes('start'))).toHaveLength(1);expect(exec.mock.calls.find(([,a])=>a.includes('start'))[1]).toContain('-w');
});
it('refuses to stop connected clients and otherwise uses a bounded smart shutdown',()=>{
 clients=1;expect(()=>runtime.stop()).toThrow('still has client connections');expect(exec.mock.calls.some(([,a])=>a.includes('stop'))).toBe(false);clients=0;runtime.stop();expect(exec.mock.calls.at(-1)[1]).toEqual(['-D',p.dataDirectory,'-m','smart','-w','-t','30','stop']);
});
it('does not let a native context fall back to the legacy container adapter',()=>{expect(()=>databaseOperations({kind:'native',docker:vi.fn()})).toThrow('tool port missing');});
it('retains container identity checks before SQL and rejects a foreign container',()=>{
 const config={container:'fixture',image:'sha256:pinned'};const call=vi.fn(()=>JSON.stringify([{Config:{Image:'sha256:foreign',Labels:{'com.loop-control.project':'/fixture/project','com.loop-control.runtime':'local-daily'}}}]));const c=createDatabaseRuntime({postgres:config,database:{database:'loop_control'}},{projectRoot:'/fixture/project',root,operations:{execFileSync:call}});expect(()=>c.sql('SELECT 1')).toThrow('container identity mismatch');expect(call).toHaveBeenCalledTimes(1);
});
