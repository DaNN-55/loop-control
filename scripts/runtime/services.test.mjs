// @vitest-environment node
import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const ports=vi.hoisted(()=>({connect:vi.fn(),query:vi.fn(),end:vi.fn(),spawn:vi.fn(),exec:vi.fn(),inspect:vi.fn(),exists:vi.fn(),read:vi.fn(),write:vi.fn(),rename:vi.fn(),docker:vi.fn(),assert:vi.fn(),sql:vi.fn(),started:false,sshError:'',child:null}));
vi.mock('pg',()=>({Client:class{connect=ports.connect;query=ports.query;end=ports.end;}}));
vi.mock('node:child_process',()=>({spawn:ports.spawn,execFileSync:ports.exec}));
vi.mock('node:fs',()=>({existsSync:ports.exists,readFileSync:ports.read,renameSync:ports.rename,statSync:()=>({dev:2}),openSync:()=>10,closeSync:vi.fn(),fstatSync:()=>({size:ports.started?Buffer.byteLength(ports.sshError):0}),readSync:(_fd,buffer,offset,length,position)=>Buffer.from(ports.sshError).copy(buffer,offset,position,position+length)}));
vi.mock('./environment.mjs',()=>({root:'/fixture/runtime',projectRoot:'/fixture/project',assertPrivatePath:vi.fn(),readSettings:()=>({database:{host:'127.0.0.1',port:54329,database:'loop_control',user:'loop_app',password:'fixture-password'}}),runtimeContext:()=>({container:'fixture-postgres',docker:ports.docker,assertDatabase:ports.assert,sql:ports.sql}),writePrivateFile:ports.write}));
vi.mock('./keychain.mjs',()=>({hydrateDeploymentSecrets:value=>value}));
vi.mock('../local-service-record.mjs',()=>({inspectRecordedService:ports.inspect}));
import {ensureServices} from './services.mjs';
const starting=()=>Object.assign(new Error('the database system is starting up'),{code:'57P03'});
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();ports.started=false;ports.sshError='';
 ports.connect.mockReset().mockResolvedValue(undefined);ports.query.mockReset().mockResolvedValue({rows:[{db:'loop_control',role:'loop_app'}]});ports.end.mockReset().mockResolvedValue(undefined);
 ports.exists.mockReset().mockReturnValue(false);ports.inspect.mockReset().mockReturnValue({valid:false});ports.read.mockReset().mockReturnValue('{}');ports.docker.mockReset().mockImplementation(args=>args[0]==='inspect'?JSON.stringify([{State:{Running:true}}]):'ready');
 ports.exec.mockReset().mockReturnValue('n127.0.0.1:54329\n');
 ports.spawn.mockReset().mockImplementation(()=>{ports.started=true;const child=new EventEmitter();child.pid=555;child.exitCode=1;child.kill=vi.fn();child.unref=vi.fn();ports.child=child;queueMicrotask(()=>child.emit('spawn'));return child;});
});
afterEach(()=>vi.useRealTimers());
async function result(){const pending=ensureServices().then(()=>({ok:true}),error=>({error}));await vi.runAllTimersAsync();return pending;}
it('waits for PostgreSQL behind an existing Colima listener without starting a competing tunnel',async()=>{
 ports.connect.mockRejectedValueOnce(starting());
 expect(await result()).toEqual({ok:true});expect(ports.connect).toHaveBeenCalledTimes(2);expect(ports.spawn).not.toHaveBeenCalled();expect(ports.write).not.toHaveBeenCalled();expect(ports.sql).toHaveBeenCalledWith('SELECT 1');
});
it('keeps a failing existing listener untouched and reports its database error',async()=>{
 ports.connect.mockRejectedValue(starting());
 const outcome=await result();expect(outcome.error?.message).toContain('57P03');expect(outcome.error?.message).toContain('starting up');expect(ports.spawn).not.toHaveBeenCalled();expect(ports.write).not.toHaveBeenCalled();
});
it('reports invalid credentials without attempting to replace the tunnel or exposing the password',async()=>{
 ports.connect.mockRejectedValue(Object.assign(new Error('authentication failed: fixture-password'),{code:'28P01'}));
 const outcome=await result();expect(outcome.error?.message).toContain('28P01');expect(outcome.error?.message).not.toContain('fixture-password');expect(ports.connect).toHaveBeenCalledTimes(1);expect(ports.spawn).not.toHaveBeenCalled();
});
it('refuses a reachable database with an unexpected identity',async()=>{
 ports.query.mockResolvedValue({rows:[{db:'foreign_database',role:'foreign_role'}]});
 const outcome=await result();expect(outcome.error?.message).toMatch(/identity/i);expect(ports.spawn).not.toHaveBeenCalled();expect(ports.sql).not.toHaveBeenCalled();
});
it('retains the SSH diagnostic when a new tunnel exits before listening',async()=>{
 ports.connect.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'),{code:'ECONNREFUSED'}));ports.exec.mockImplementation(()=>{throw Object.assign(new Error('no listener'),{status:1,stdout:''});});ports.sshError='bind [127.0.0.1]:54329: Address already in use';
 const outcome=await result();expect(outcome.error?.message).toContain('Address already in use');expect(ports.spawn).toHaveBeenCalledTimes(1);expect(ports.write).not.toHaveBeenCalled();
});
it('accepts a verified Colima listener that wins the port race while SSH is starting',async()=>{
 ports.connect.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'),{code:'ECONNREFUSED'}));ports.exec.mockImplementationOnce(()=>{throw Object.assign(new Error('no listener'),{status:1,stdout:''});});ports.sshError='Address already in use';
 expect(await result()).toEqual({ok:true});expect(ports.spawn).toHaveBeenCalledTimes(1);expect(ports.write).not.toHaveBeenCalled();expect(ports.sql).toHaveBeenCalledWith('SELECT 1');
});
it('records a newly created tunnel only after verifying its database identity',async()=>{
 ports.connect.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'),{code:'ECONNREFUSED'}));ports.exec.mockImplementationOnce(()=>{throw Object.assign(new Error('no listener'),{status:1,stdout:''});});ports.inspect.mockReturnValue({valid:true});ports.spawn.mockImplementation(()=>{ports.started=true;const child=new EventEmitter();child.pid=555;child.exitCode=null;child.kill=vi.fn();child.unref=vi.fn();ports.child=child;queueMicrotask(()=>child.emit('spawn'));return child;});
 expect(await result()).toEqual({ok:true});expect(ports.write).toHaveBeenCalledWith('/fixture/runtime/tunnel.json',expect.stringContaining('555'),{exclusive:true});expect(ports.child.unref).toHaveBeenCalledTimes(1);expect(ports.child.kill).not.toHaveBeenCalled();
});
