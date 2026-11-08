// @vitest-environment node
import{it,expect,vi}from'vitest';
const ports=vi.hoisted(()=>({worker:vi.fn(async()=>({stop:vi.fn()})),connections:vi.fn(),accountClose:vi.fn(),runtime:vi.fn(()=>vi.fn()),store:vi.fn(()=>({mode:'keychain'})),probe:vi.fn(()=>({mode:'live'})),providerProbe:vi.fn((config,_transport,_readOnly,options)=>({mode:'live',networkAvailable:false,config,options}))}));
vi.mock('../../src/orchestration/runtimeBuild.ts',()=>({readPreparedRuntimeRelease:async()=>({id:'fixture-release',root:new URL('../../',import.meta.url).pathname.replace(/\/$/,'')}),assertRuntimeRelease:async()=>{}}));
vi.mock('../../dist/local-app/local-app/catalog.js',()=>({createLocalDatabase:()=>({end:vi.fn(),query:vi.fn()})}));
vi.mock('../../dist/local-app/local-app/mediaRootSettings.js',()=>({inspectMediaRoot:async path=>({path,deviceId:'fixture-device',inodeId:'fixture-inode',mountPath:'/isolated/volume'}),verifyMediaRootBinding:async value=>value,LocalMediaRootSettings:class{close=vi.fn();}}));
vi.mock('../../dist/local-app/local-app/runtimeStatus.js',()=>({createRuntimeStatusReader:ports.runtime}));
vi.mock('../../dist/local-app/local-app/mediaDeployment.js',()=>({readMediaDeployment:vi.fn(async()=>[])}));
vi.mock('../../dist/local-app/local-app/localWorkerService.js',()=>({startNativeWorkerService:ports.worker}));
vi.mock('../../dist/local-app/local-app/connections.js',()=>({LocalConnections:class{constructor(...args){ports.connections(...args);}}}));
vi.mock('../../dist/local-app/local-app/keychainStore.js',()=>({configuredKeychainStore:ports.store}));
vi.mock('../../dist/local-app/local-app/pexelsLiveProbe.js',()=>({createPexelsLiveProbe:ports.probe}));
vi.mock('../../dist/local-app/local-app/providerProbe.js',()=>({createProviderProbe:ports.providerProbe}));
vi.mock('../../dist/local-app/local-app/episodeCommands.js',()=>({LocalEpisodeCommands:class{close=vi.fn();startScriptContinuation=vi.fn();}}));
vi.mock('../../dist/local-app/local-app/accountCommands.js',()=>({LocalAccountCommands:class{close=ports.accountClose;}}));
vi.mock('../../dist/local-app/local-app/nativeAutomation.js',()=>({startNativeAutomation:async()=>({stop:vi.fn()})}));
vi.mock('../../dist/local-app/local-app/nativeBackup.js',()=>({nativeBackup:vi.fn()}));
vi.mock('../../dist/local-app/local-app/localRoute.js',()=>({createLocalHandler:vi.fn()}));
vi.mock('../../dist/local-app/local-app/secretAdministration.js',()=>({SecretAdministration:class{}}));
import{createNativeApplication}from'./application.mjs';
import{createLocalHandler}from'../../dist/local-app/local-app/localRoute.js';
it('closes the native account dialog resource once when application close is repeated',async()=>{
 const before=ports.accountClose.mock.calls.length;
 const app=await createNativeApplication({runtimeRoot:'/isolated/.loop-control/local',projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189});
 await Promise.all([app.close(),app.close()]);expect(ports.accountClose.mock.calls.length).toBe(before+1);
});
it('assembles approved deployment ports in the normal factory and refuses a network reservation',async()=>{
 const d={projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189,worker:{studio:true},workerDatabase:{},connections:{keychain:{approved:true,runtimeRoot:'/isolated/.loop-control/stage-d',helperSha256:'pinned'},verification:'pexels-offline'},openChatCut:{root:'/isolated/OpenChatCut',node:'/isolated/node'}};
 const app=await createNativeApplication({...d,runtimeRoot:'/isolated/.loop-control/local'});try{expect(ports.store).toHaveBeenCalledWith(d.connections.keychain,undefined);expect(ports.connections.mock.calls.at(-1)[1]).toEqual({mode:'keychain'});expect(ports.probe.mock.calls.at(-1)[0].reserveRequest()).toBe(false);expect(ports.worker.mock.calls.at(-1)[0].environment).toMatchObject({OPENCHATCUT_ROOT:d.openChatCut.root,OPENCHATCUT_NODE:d.openChatCut.node});}finally{await app.close();}
});
it('keeps absent capability configuration disabled and ignores ambient OpenChatCut',async()=>{
 vi.stubEnv('OPENCHATCUT_ROOT','/unapproved');const before=ports.store.mock.calls.length;const app=await createNativeApplication({runtimeRoot:'/isolated/.loop-control/local',projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189,worker:{},workerDatabase:{}});try{expect(ports.store.mock.calls.length).toBe(before);expect(ports.connections.mock.calls.at(-1)[1]).toBeUndefined();expect(ports.worker.mock.calls.at(-1)[0].environment.OPENCHATCUT_ROOT).toBeUndefined();}finally{await app.close();vi.unstubAllEnvs();}
});
it('assembles the closed six-provider probe and passes the same private budget to the Worker',async()=>{
 const network={directory:'/isolated/state/provider-network',policySha256:'a'.repeat(64)},keychain={approved:true,runtimeRoot:'/isolated/.loop-control/stage-d',helperSha256:'pinned'};const d={projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189,worker:{media:{mode:'live',network,keychain},narration:{mode:'live',network,keychain}},workerDatabase:{},connections:{keychain,network,verification:'providers-budgeted'}};
 const app=await createNativeApplication({...d,runtimeRoot:'/isolated/.loop-control/local'});try{expect(ports.connections.mock.calls.at(-1)[2]).toMatchObject({mode:'live',networkAvailable:false,config:network});expect(ports.worker.mock.calls.at(-1)[0].media.network).toBe(network);expect(ports.worker.mock.calls.at(-1)[0].narration.network).toBe(network);}finally{await app.close();}
});

it('assembles manual connection tests without sharing production request budgets or temporary permits',async()=>{
 const network={directory:'/isolated/state/generation-budget',policySha256:'a'.repeat(64)},keychain={approved:true,runtimeRoot:'/isolated/.loop-control/local',helperSha256:'pinned'};
 const d={projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189,connections:{keychain,network,verification:'manual',readOnlyVerification:{bailian:{directory:'/expired',policySha256:'b'.repeat(64)}}}};
 const app=await createNativeApplication({...d,runtimeRoot:'/isolated/.loop-control/local'});try{expect(ports.providerProbe).toHaveBeenLastCalledWith(network,undefined,undefined,{manualVerification:true});expect(ports.connections.mock.calls.at(-1)[2]).toMatchObject({options:{manualVerification:true},networkAvailable:false});}finally{await app.close();}
});

it('uses configured connections for image, video and speech in the daily app and Worker',async()=>{
 const network={directory:'/expired',policySha256:'a'.repeat(64)},keychain={approved:true,runtimeRoot:'/isolated/.loop-control/local',helperSha256:'pinned'};
 const d={purpose:'local-daily',projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189,connections:{keychain,network,verification:'manual'},workerDatabase:{},worker:{media:{mode:'live',network,keychain},narration:{mode:'live',network,keychain}}};
 const app=await createNativeApplication({...d,runtimeRoot:'/isolated/.loop-control/local'});try{
  expect(ports.connections.mock.calls.at(-1)[2]).toMatchObject({options:{manualVerification:true,workspaceGenerationFromConnections:true,workspaceSpeechFromConnections:true}});
  expect(ports.worker.mock.calls.at(-1)[0].media).toMatchObject({workspaceGenerationFromConnections:true});
  expect(ports.worker.mock.calls.at(-1)[0].narration).toMatchObject({workspaceSpeechFromConnections:true});
 }finally{await app.close();}
});

it('wires the runtime status reader into the authenticated native route',async()=>{
 ports.worker.mockResolvedValueOnce({stop:vi.fn(),runtimeRelease:{id:'worker-selected',root:'/worker-release'}});
 const d={runtimeRelease:{id:'backend-selected',root:new URL('../../',import.meta.url).pathname.replace(/\/$/,'')},runtimeRoot:'/isolated/.loop-control/local',projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189,worker:{mountPath:'/isolated/volume',minimumFreeBytes:1024},workerDatabase:{}};
 const app=await createNativeApplication(d);try{
  expect(ports.runtime).toHaveBeenLastCalledWith(expect.objectContaining({projectRoot:d.projectRoot,mediaRoot:d.mediaRoot,mountPath:d.worker.mountPath,minimumFreeBytes:1024}));
  expect(createLocalHandler).toHaveBeenLastCalledWith(expect.objectContaining({runtimeStatus:ports.runtime.mock.results.at(-1).value}));
  const selected=ports.runtime.mock.calls.at(-1)[0];expect(selected.runtimeRelease).toEqual(d.runtimeRelease);expect(selected.workerRelease()).toBe('worker-selected');
 }finally{await app.close();}
});
