// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const ports=vi.hoisted(()=>({exists:true,valid:true,events:[],stop:vi.fn(),keychain:vi.fn(),unlink:vi.fn()}));
vi.mock('./keychain.mjs',()=>({keychainState:ports.keychain}));
vi.mock('node:fs',()=>({existsSync:()=>ports.exists,readFileSync:()=>JSON.stringify({pid:444,projectRoot:'/fixture/project',deploymentFile:'/fixture/runtime/deployment.json'}),unlinkSync:ports.unlink}));
vi.mock('./environment.mjs',()=>({projectRoot:'/fixture/project',root:'/fixture/runtime',readSettings:()=>({port:5174,postgres:{kind:'native'}}),runtimeContext:()=>({stop:ports.stop})}));
vi.mock('../local-service-record.mjs',()=>({inspectRecordedService:()=>({valid:ports.valid})}));
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();ports.exists=true;ports.valid=true;ports.events=[];process.exitCode=0;
 ports.stop.mockImplementation(()=>ports.events.push('database-stop'));ports.keychain.mockImplementation(()=>ports.events.push('keychain-lock'));ports.unlink.mockImplementation(()=>ports.events.push('app-record-removed'));
 vi.spyOn(process,'kill').mockImplementation((_pid,signal)=>{if(signal==='SIGTERM'){ports.events.push('app-sigterm');return true;}throw Object.assign(Error('exited'),{code:'ESRCH'});});
 vi.spyOn(console,'log').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(()=>{vi.restoreAllMocks();process.exitCode=0;});
it('stops the verified application before stopping its native cluster and locking secrets',async()=>{await import('./stop.mjs');expect(ports.events).toEqual(['app-sigterm','app-record-removed','database-stop','keychain-lock']);});
it('does not stop PostgreSQL when a live application record cannot be verified',async()=>{ports.valid=false;await import('./stop.mjs');expect(process.kill).not.toHaveBeenCalled();expect(ports.stop).not.toHaveBeenCalled();expect(ports.keychain).not.toHaveBeenCalled();expect(process.exitCode).toBe(1);});
it('retains native refusal to stop connected clients as a failed stop',async()=>{ports.exists=false;ports.stop.mockImplementation(()=>{throw Error('Native PostgreSQL still has client connections; not stopped');});await import('./stop.mjs');expect(process.exitCode).toBe(1);expect(ports.keychain).not.toHaveBeenCalled();});
