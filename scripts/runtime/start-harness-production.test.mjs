// @vitest-environment node
import {EventEmitter} from 'node:events';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const ports=vi.hoisted(()=>({load:vi.fn(),spawn:vi.fn(),unlock:vi.fn(),ensure:vi.fn(),prepare:vi.fn(),running:false}));
vi.mock('./harness-production-config.mjs',()=>({loadHarnessProductionEnvironment:ports.load}));
vi.mock('../../src/orchestration/runtimeBuild.ts',()=>({readPreparedRuntimeRelease:async()=>({id:'fixture',root:'/fixture/release'})}));
vi.mock('./keychain.mjs',()=>({keychainState:ports.unlock}));
vi.mock('./services.mjs',()=>({ensureServices:ports.ensure}));
vi.mock('./environment.mjs',()=>({projectRoot:'/fixture/project',readDeployment:()=>({port:5174,recordPath:'/fixture/app.json',logPath:'/fixture/log',home:'/fixture/home',deploymentFile:'/fixture/deployment.json'}),writePrivateFile:vi.fn()}));
vi.mock('../local-service-record.mjs',()=>({inspectRecordedService:()=>({valid:true})}));
vi.mock('node:fs',async()=>({constants:(await vi.importActual('node:fs')).constants,existsSync:()=>ports.running,readFileSync:()=>JSON.stringify({pid:333,port:5174}),renameSync:vi.fn(),openSync:()=>10,closeSync:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:ports.spawn,execFileSync:ports.prepare}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();ports.running=false;ports.load.mockResolvedValue({LOOP_HARNESS_PRODUCTION_DIR:'/fixture/private',LOOP_HARNESS_PRODUCTION_OWNER_ID:'owner',LOOP_HARNESS_PRODUCTION_EPISODE_IDS:'episode'});ports.spawn.mockImplementation(()=>{const child=new EventEmitter();child.pid=999;child.exitCode=null;child.unref=vi.fn();queueMicrotask(()=>child.emit('spawn'));return child;});vi.spyOn(console,'log').mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());
it('loads workspace opt-in before side effects and passes only validated values to the app child',async()=>{await import('./start.mjs');expect(ports.load).toHaveBeenCalledWith({runtimeRoot:'/fixture/project/.loop-control/local'});expect(ports.spawn.mock.calls[0][2].env).toMatchObject({LOOP_HARNESS_PRODUCTION_DIR:'/fixture/private',LOOP_HARNESS_PRODUCTION_OWNER_ID:'owner',LOOP_HARNESS_PRODUCTION_EPISODE_IDS:'episode'});expect(ports.load.mock.invocationCallOrder[0]).toBeLessThan(ports.unlock.mock.invocationCallOrder[0]);});
it('fails malformed opt-in before unlocking Keychain, starting services or preparing releases',async()=>{ports.load.mockRejectedValue(Error('invalid opt-in'));await expect(import('./start.mjs')).rejects.toThrow('invalid opt-in');expect(ports.unlock).not.toHaveBeenCalled();expect(ports.ensure).not.toHaveBeenCalled();expect(ports.prepare).not.toHaveBeenCalled();expect(ports.spawn).not.toHaveBeenCalled();});
it('does not restart a live matching daily process to apply changed opt-in',async()=>{ports.running=true;await import('./start.mjs');expect(ports.spawn).not.toHaveBeenCalled();expect(ports.prepare).not.toHaveBeenCalled();});
