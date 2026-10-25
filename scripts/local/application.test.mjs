// @vitest-environment node
import{it,expect,vi}from'vitest';
const ports=vi.hoisted(()=>({worker:vi.fn(async()=>({stop:vi.fn()})),connections:vi.fn(),store:vi.fn(()=>({mode:'keychain'})),probe:vi.fn(()=>({mode:'live'}))}));
vi.mock('../../dist/local-app/local-app/catalog.js',()=>({createLocalDatabase:()=>({end:vi.fn()})}));
vi.mock('../../dist/local-app/local-app/mediaDeployment.js',()=>({readMediaDeployment:vi.fn()}));
vi.mock('../../dist/local-app/local-app/localWorkerService.js',()=>({startNativeWorkerService:ports.worker}));
vi.mock('../../dist/local-app/local-app/connections.js',()=>({LocalConnections:class{constructor(...args){ports.connections(...args);}}}));
vi.mock('../../dist/local-app/local-app/keychainStore.js',()=>({configuredKeychainStore:ports.store}));
vi.mock('../../dist/local-app/local-app/pexelsLiveProbe.js',()=>({createPexelsLiveProbe:ports.probe}));
vi.mock('../../dist/local-app/local-app/episodeCommands.js',()=>({LocalEpisodeCommands:class{close=vi.fn();}}));
vi.mock('../../dist/local-app/local-app/nativeAutomation.js',()=>({startNativeAutomation:async()=>({stop:vi.fn()})}));
vi.mock('../../dist/local-app/local-app/nativeBackup.js',()=>({nativeBackup:vi.fn()}));
vi.mock('../../dist/local-app/local-app/localRoute.js',()=>({createLocalHandler:vi.fn()}));
import{createNativeApplication}from'./application.mjs';
it('assembles approved deployment ports in the normal factory and refuses a network reservation',async()=>{
 const d={projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189,worker:{studio:true},workerDatabase:{},connections:{keychain:{approved:true,runtimeRoot:'/isolated/.loop-control/stage-d',helperSha256:'pinned'},verification:'pexels-offline'},openChatCut:{root:'/isolated/OpenChatCut',node:'/isolated/node'}};
 const app=await createNativeApplication(d);try{expect(ports.store).toHaveBeenCalledWith(d.connections.keychain);expect(ports.connections.mock.calls.at(-1)[1]).toEqual({mode:'keychain'});expect(ports.probe.mock.calls.at(-1)[0].reserveRequest()).toBe(false);expect(ports.worker.mock.calls.at(-1)[0].environment).toMatchObject({OPENCHATCUT_ROOT:d.openChatCut.root,OPENCHATCUT_NODE:d.openChatCut.node});}finally{await app.close();}
});
it('keeps absent capability configuration disabled and ignores ambient OpenChatCut',async()=>{
 vi.stubEnv('OPENCHATCUT_ROOT','/unapproved');const before=ports.store.mock.calls.length;const app=await createNativeApplication({projectRoot:'/isolated',home:'/isolated/home',stateDirectory:'/isolated/state',mediaRoot:'/isolated/media',database:{database:'isolated'},port:55189,worker:{},workerDatabase:{}});try{expect(ports.store.mock.calls.length).toBe(before);expect(ports.connections.mock.calls.at(-1)[1]).toBeUndefined();expect(ports.worker.mock.calls.at(-1)[0].environment.OPENCHATCUT_ROOT).toBeUndefined();}finally{await app.close();vi.unstubAllEnvs();}
});
