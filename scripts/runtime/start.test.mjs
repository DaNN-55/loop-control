// @vitest-environment node
import {EventEmitter} from 'node:events';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const ports=vi.hoisted(()=>({exists:true,matching:false,inspect:vi.fn(),rename:vi.fn(),write:vi.fn(),spawn:vi.fn(),prepare:vi.fn(),unlock:vi.fn(),ensure:vi.fn()}));
vi.mock('./keychain.mjs',()=>({keychainState:ports.unlock}));
vi.mock('./services.mjs',()=>({ensureServices:ports.ensure}));
vi.mock('./environment.mjs',()=>({projectRoot:'/fixture/project',readDeployment:()=>({port:5174,recordPath:'/fixture/runtime/app.json',logPath:'/fixture/runtime/app-private.log',home:'/fixture/home',deploymentFile:'/fixture/runtime/deployment.json'}),writePrivateFile:ports.write}));
vi.mock('../local-service-record.mjs',()=>({inspectRecordedService:ports.inspect}));
vi.mock('node:fs',()=>({existsSync:()=>ports.exists,readFileSync:()=>JSON.stringify({pid:444,port:5174,projectRoot:'/fixture/project'}),renameSync:ports.rename,openSync:()=>10,closeSync:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:ports.spawn,execFileSync:ports.prepare}));
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();ports.exists=true;ports.matching=false;
 ports.ensure.mockResolvedValue(undefined);ports.inspect.mockImplementation(value=>({valid:value.pid===999||ports.matching}));ports.rename.mockImplementation(()=>{ports.exists=false;});ports.write.mockImplementation(()=>{ports.exists=true;});
 ports.spawn.mockImplementation(()=>{const child=new EventEmitter();child.pid=999;child.exitCode=null;child.kill=vi.fn();child.unref=vi.fn();queueMicrotask(()=>child.emit('spawn'));return child;});
 vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('No such process'),{code:'ESRCH'});});vi.spyOn(console,'log').mockImplementation(()=>{});
});
afterEach(()=>vi.restoreAllMocks());
it('archives a record only after confirming its process exited, then starts normally',async()=>{
 await import('./start.mjs');
 expect(process.kill).toHaveBeenCalledWith(444,0);expect(ports.rename).toHaveBeenCalledWith('/fixture/runtime/app.json',expect.stringMatching(/app\.json\.stale-\d+$/));expect(ports.spawn).toHaveBeenCalledTimes(1);expect(ports.write).toHaveBeenCalledWith('/fixture/runtime/app.json',expect.stringContaining('999'),{exclusive:true});
});
it('does not archive or stop a live process whose identity does not match',async()=>{
 process.kill.mockImplementation(()=>true);
 await expect(import('./start.mjs')).rejects.toThrow('Recorded daily service does not match');expect(ports.rename).not.toHaveBeenCalled();expect(ports.spawn).not.toHaveBeenCalled();expect(process.kill).toHaveBeenCalledWith(444,0);
});
it('reuses the matching live application without preparing or spawning another instance',async()=>{
 ports.matching=true;await import('./start.mjs');expect(ports.spawn).not.toHaveBeenCalled();expect(ports.prepare).not.toHaveBeenCalled();expect(ports.rename).not.toHaveBeenCalled();
});
