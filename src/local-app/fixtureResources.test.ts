// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixtureResources} from './fixtureResources';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

it('continues releasing other owned resources after a release fails and reports the failure',async()=>{
 const root=await mkdtemp(join(tmpdir(),'loop-fixture-resources-'));roots.push(root);
 const first=join(root,'first'),second=join(root,'second');await writeFile(first,'owned');await writeFile(second,'owned');
 const failure=Error('controlled release failure'),resources=fixtureResources();
 resources.defer(()=>unlink(first));
 resources.defer(async()=>{await unlink(second);throw failure;});
 await expect(resources.close()).rejects.toMatchObject({errors:[failure]});
 for(const file of [first,second])await expect(readFile(file)).rejects.toMatchObject({code:'ENOENT'});
 await expect(resources.close()).rejects.toMatchObject({errors:[failure]});
});

it('preserves both setup and cleanup failures without skipping remaining cleanup',async()=>{
 const setup=Error('setup'),cleanup=Error('cleanup'),resources=fixtureResources();let released=false;
 resources.defer(()=>{released=true;});resources.defer(()=>{throw cleanup;});
 await expect(resources.fail(setup)).rejects.toMatchObject({errors:[setup,{errors:[cleanup]}]});expect(released).toBe(true);
});

it('releases once when setup fails and close is called again',async()=>{
 const failure=Error('setup'),resources=fixtureResources();let releases=0;
 resources.defer(()=>{releases++;});await expect(resources.fail(failure)).rejects.toBe(failure);
 await resources.close();expect(releases).toBe(1);
});
