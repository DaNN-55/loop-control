// @vitest-environment node
import{it,expect,afterEach}from'vitest';
import{mkdirSync,mkdtempSync,writeFileSync,rmSync}from'node:fs';import{join,resolve}from'node:path';
import{assertOfflinePrepared,inspectOfflineAssets}from'./offline-preparation.mjs';
const bases=[];
afterEach(()=>{for(const p of bases.splice(0))rmSync(p,{recursive:true,force:true});});
it('requires a successful preparation and rejects assets changed after preparation',async()=>{
 const parent=resolve('.loop-control/stage-d/state');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'t24-offline-test-'));bases.push(base);
 const deploymentFile=join(base,'deployment.json'),asset=join(base,'asset');writeFileSync(deploymentFile,'{}');writeFileSync(asset,'abc');
 writeFileSync(join(base,'offline-assets.json'),JSON.stringify({version:1,model:'jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn',packages:[{name:'whisperx',version:'3.8.6'}],files:[{path:asset,bytes:3,sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}]}));
 const d={deploymentFile,projectRoot:resolve('.')};await expect(assertOfflinePrepared(d)).rejects.toThrow();
 const{identity}=await inspectOfflineAssets(d);writeFileSync(join(base,'offline-preparation.json'),JSON.stringify({version:1,passed:true,identity,modelProbeTimeoutMs:30000}));await expect(assertOfflinePrepared(d)).resolves.toMatchObject({passed:true});
 writeFileSync(asset,'abd');await expect(assertOfflinePrepared(d)).rejects.toThrow('Offline asset changed');
});
it('rejects an out-of-tree manifest entry before opening it',async()=>{
 const parent=resolve('.loop-control/stage-d/state');mkdirSync(parent,{recursive:true});const base=mkdtempSync(join(parent,'t24-offline-test-'));bases.push(base);const deploymentFile=join(base,'deployment.json');writeFileSync(deploymentFile,'{}');
 writeFileSync(join(base,'offline-assets.json'),JSON.stringify({version:1,model:'jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn',packages:[{}],files:[{path:'/outside/production-secret',bytes:1,sha256:'0'.repeat(64)}]}));await expect(inspectOfflineAssets({deploymentFile,projectRoot:resolve('.')})).rejects.toThrow('隔离路径离开工作树');
});
