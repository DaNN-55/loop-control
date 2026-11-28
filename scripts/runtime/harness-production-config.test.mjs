// @vitest-environment node
import {it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtemp,realpath,mkdir,writeFile,chmod,symlink,link,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {loadHarnessProductionEnvironment} from './harness-production-config.mjs';
let root,directory,file;
const owner='644f8c5a-b668-48a3-8a25-94c4e502fa04',episode='12345678-1234-1234-1234-123456789abc';
beforeEach(async()=>{root=await realpath(await mkdtemp(join(tmpdir(),'lhp-')));directory=join(root,'socket');file=join(root,'harness-production.json');await mkdir(directory,{mode:0o700});});
afterEach(async()=>{if(await realpath(root)!==root||!basename(root).startsWith('lhp-')||(await lstat(root)).uid!==process.getuid())throw Error('Unexpected test cleanup path');await rm(root,{recursive:true});});
const write=async value=>writeFile(file,JSON.stringify(value),{mode:0o600});
const active=()=>({version:1,enabled:true,productionDir:directory,ownerId:owner});
const read=(environment={},options={})=>loadHarnessProductionEnvironment({runtimeRoot:root,environment,...options});
it('leaves absent and explicitly disabled workspaces unchanged',async()=>{expect(await read()).toEqual({});await write({version:1,enabled:false});expect(await read()).toEqual({});});
it('maps explicit private opt-in to only the existing runtime variables',async()=>{await write({...active(),episodeIds:[episode,episode.toUpperCase()]});expect(await read()).toEqual({LOOP_HARNESS_PRODUCTION_DIR:directory,LOOP_HARNESS_PRODUCTION_OWNER_ID:owner,LOOP_HARNESS_PRODUCTION_EPISODE_IDS:episode});});
it('uses a complete shell binding without mixing file Owner or scope',async()=>{await writeFile(file,'not valid JSON',{mode:0o600});expect(await read({LOOP_HARNESS_PRODUCTION_DIR:directory,LOOP_HARNESS_PRODUCTION_OWNER_ID:owner})).toEqual({LOOP_HARNESS_PRODUCTION_DIR:directory,LOOP_HARNESS_PRODUCTION_OWNER_ID:owner});});
it.each([{LOOP_HARNESS_PRODUCTION_DIR:'directory'},{LOOP_HARNESS_PRODUCTION_OWNER_ID:owner},{LOOP_HARNESS_PRODUCTION_EPISODE_IDS:episode}])('rejects partial environment override %j',async environment=>{await write(active());await expect(read(environment)).rejects.toThrow();});
it.each([null,[],{}, {version:2,enabled:true},{version:1,enabled:'true'}, {version:1,enabled:false,secret:'forbidden'}])('rejects invalid shape or unknown fields %j',async value=>{await write(value);await expect(read()).rejects.toThrow();});
it.each([{ownerId:'not-a-uuid'},{episodeIds:[]},{episodeIds:['']},{episodeIds:'not-an-array'},{episodeIds:['bad']},{productionDir:'relative'}])('rejects invalid binding %j',async value=>{await write({...active(),...value});await expect(read()).rejects.toThrow();});
it('rejects malformed, oversized and non-UTF8 config bytes',async()=>{for(const bytes of ['{',' '.repeat(16385),Buffer.from([0xff])]){await writeFile(file,bytes,{mode:0o600});await expect(read()).rejects.toThrow();}});
it('rejects nonprivate configuration, wrong owner, config symlinks and hardlinks',async()=>{
 await write(active());await chmod(file,0o640);await expect(read()).rejects.toThrow();await chmod(file,0o600);await expect(read({}, {uid:process.getuid()+1})).rejects.toThrow();
 await link(file,join(root,'hardlink'));await expect(read()).rejects.toThrow();
 const alias=join(root,'alias');await mkdir(alias,{mode:0o700});await symlink(file,join(alias,'harness-production.json'));await expect(loadHarnessProductionEnvironment({runtimeRoot:alias,environment:{}})).rejects.toThrow();
});
it('rejects unsafe and aliased directories, excessive socket paths and empty shell scope',async()=>{
 await write(active());await chmod(directory,0o750);await expect(read()).rejects.toThrow();await chmod(directory,0o700);
 const alias=join(root,'alias');await symlink(directory,alias);await write({...active(),productionDir:alias});await expect(read()).rejects.toThrow();
 const long=join(root,'x'.repeat(100));await mkdir(long,{mode:0o700});await write({...active(),productionDir:long});await expect(read()).rejects.toThrow();
 await expect(read({LOOP_HARNESS_PRODUCTION_DIR:directory,LOOP_HARNESS_PRODUCTION_OWNER_ID:owner,LOOP_HARNESS_PRODUCTION_EPISODE_IDS:''})).rejects.toThrow();
});
it('rejects a nonprivate runtime config parent and an aliased runtime root',async()=>{await write(active());await chmod(root,0o750);await expect(read()).rejects.toThrow();await chmod(root,0o700);const alias=join(root,'self');await symlink(root,alias);await expect(loadHarnessProductionEnvironment({runtimeRoot:alias,environment:{}})).rejects.toThrow();});
