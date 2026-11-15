// @vitest-environment node
import {expect,it} from 'vitest';
import {readFile,readdir,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {assertRuntimeRelease,runtimeExecutionContract} from './runtimeBuild';
const archivedRoot=process.env.LOOP_TEST_ARCHIVED_RELEASES_ROOT;
async function treeFingerprint(root:string,directory=''):Promise<string>{
 const entries=await readdir(join(root,directory),{withFileTypes:true}),rows:Array<[string,string]>=[];
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.isSymbolicLink())throw Error('Archived runtime alias');const path=join(directory,entry.name);
  rows.push([path,entry.isDirectory()?await treeFingerprint(root,path):createHash('sha256').update(await readFile(join(root,path))).digest('hex')]);
 }
 return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
it.skipIf(!archivedRoot)('all 23 real archived runtimes are refused by the current execution gate with all bytes intact',async()=>{
 const archive=await realpath(archivedRoot!),project=dirname(dirname(archive)),inventory=JSON.parse(await readFile(join(process.cwd(),'docs/runtime/runtime-support.json'),'utf8'));
 expect(inventory.currentExecutionPolicy).toMatchObject({manifestVersion:5,executionContract:runtimeExecutionContract,archivedManifestV4:'rejected-by-current-entrypoints'});
 expect(inventory.releases).toHaveLength(23);const receipts=[];
 for(const entry of inventory.releases){
  const root=join(archive,entry.id),before=await treeFingerprint(root),manifest=JSON.parse(await readFile(join(root,'dist/runtime-manifest.json'),'utf8'));
  expect(manifest.version).toBe(4);expect(manifest.release).toEqual({id:entry.id,root});
  await expect(assertRuntimeRelease(project,manifest.release)).rejects.toMatchObject({code:'runtime_release_retired'});expect(await treeFingerprint(root)).toBe(before);receipts.push({id:entry.id,unchanged:true});
 }
 expect(receipts).toHaveLength(23);
},120000);
