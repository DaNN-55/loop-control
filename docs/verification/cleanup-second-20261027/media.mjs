import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,relative,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {runtimeContext} from '../../../scripts/runtime/environment.mjs';
const c=runtimeContext(),out=new URL('./',import.meta.url),read=async n=>JSON.parse(await fs.readFile(new URL(n,out),'utf8'));
const proposal=await read('../health-history-20261027/further-cleanup-proposal.json');
const ids=new Set(Object.values(proposal.groups).flat().map(e=>e.id)),mode=process.argv[2];
const hash=async path=>{const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');};
async function walk(dir,rows=[]){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=join(dir,e.name),st=await fs.lstat(p),path=relative(c.mediaRoot,p);if(st.isDirectory())await walk(p,rows);else if(st.isSymbolicLink())rows.push({path,link:await fs.readlink(p)});else if(st.isFile())rows.push({path,bytes:st.size});else throw Error('Unexpected media object '+path);}return rows;}
async function scan(){const rows=await walk(c.mediaRoot);let n=0;await Promise.all(Array.from({length:4},async()=>{for(;;){const i=n++;if(i>=rows.length)return;const r=rows[i];if(!r.link)r.sha256=await hash(join(c.mediaRoot,r.path));}}));return rows.sort((a,b)=>a.path.localeCompare(b.path));}
const selectedRoot=path=>{const parts=path.split('/');for(let i=0;i<parts.length-1;i++)if(parts[i]==='episodes'&&ids.has(parts[i+1]))return parts.slice(0,i+2).join('/');return null;};
if(mode==='plan'){
 const files=await scan(),roots=[...new Set(files.map(f=>selectedRoot(f.path)).filter(Boolean))].sort();
 const removed=files.filter(f=>selectedRoot(f.path));
 // The existing integrated content store must already cover deletable file bytes.
 const verified=new Set(),missing=new Set();for(const f of removed){assert(!f.link,'No symlink traversal');if(verified.has(f.sha256)||missing.has(f.sha256))continue;const stored=join(c.root,'history/content',f.sha256);try{assert.equal(await hash(stored),f.sha256,'Existing history content must match before removing runtime copy');verified.add(f.sha256);}catch(e){if(e.code!=='ENOENT')throw e;missing.add(f.sha256);}}
 const result={root:c.mediaRoot,files,roots,deleteFiles:removed.length,deleteBytes:removed.reduce((n,f)=>n+f.bytes,0),preserveFiles:files.length-removed.length,preserveBytes:files.filter(f=>!selectedRoot(f.path)).reduce((n,f)=>n+(f.bytes??0),0),existingHistoryContentVerified:verified.size,missingHistoryContent:[...missing]};
 await fs.writeFile(new URL('media-plan.json',out),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log({...result,files:undefined,roots:roots.length});
 }else if(mode==='integrate'){
 const plan=await read('media-plan.json'),dry=await read('dry-run-result.json');assert.equal(dry.deletedEpisodes,222);
 const files=plan.files.filter(f=>selectedRoot(f.path)),source=dry.historySource;
 for(const sha of plan.missingHistoryContent){const file=files.find(f=>f.sha256===sha),target=join(c.root,'history/content',sha);assert.equal(await hash(join(c.mediaRoot,file.path)),sha);try{await fs.copyFile(join(c.mediaRoot,file.path),target,1);}catch(e){if(e.code!=='EEXIST')throw e;}assert.equal(await hash(target),sha);}
 const lit=s=>"'"+s.replaceAll("'","''")+"'",pre=await read('preflight.json');
 c.sql(`BEGIN;INSERT INTO local_identity.history_sources(id,owner_id,kind,label,metadata)VALUES(${lit(source)},${lit(pre.owner)}::uuid,'maintenance-cleanup','2026-10-27 已批准的222条生产单与31个测试账号清理','{"episodes":222,"accounts":31,"executionQueue":false}')ON CONFLICT DO NOTHING;INSERT INTO local_identity.history_files(source_id,logical_path,sha256,bytes,kind,metadata)VALUES ${files.map(f=>'('+[lit(source),lit('deleted-runtime-media/'+f.path),lit(f.sha256),f.bytes,lit('media'),lit(JSON.stringify({formerRuntimePath:f.path,originalSha256:f.sha256,executionQueue:false}))+'::jsonb'].join(',')+')').join(',')} ON CONFLICT DO NOTHING;COMMIT;`);
 await fs.writeFile(new URL('media-history-result.json',out),JSON.stringify({passed:true,filesIndexed:files.length,existingContent:plan.existingHistoryContentVerified,addedUniqueContent:plan.missingHistoryContent.length,source},null,2)+'\n');console.log({filesIndexed:files.length,addedUniqueContent:plan.missingHistoryContent.length});
}else if(mode==='delete'){
 const plan=await read('media-plan.json'),commit=await read('commit-result.json');assert.equal(commit.deletedEpisodes,222);assert.equal(commit.deletedAccounts,31);assert.equal(plan.root,c.mediaRoot);assert.deepEqual(await scan(),plan.files,'Media changed after preflight');
 for(const root of plan.roots){assert.equal(selectedRoot(root),root);const path=resolve(c.mediaRoot,root);assert(path.startsWith(c.mediaRoot+'/'));assert.equal(await fs.realpath(path),path);await fs.rm(path,{recursive:true});}
 const after=await scan(),expected=plan.files.filter(f=>!selectedRoot(f.path));assert.deepEqual(after,expected,'Preserved media bytes changed');const result={passed:true,deletedDirectories:plan.roots.length,deletedFiles:plan.deleteFiles,deletedBytes:plan.deleteBytes,preservedFiles:after.length,preservedBytes:plan.preserveBytes,allPreservedMediaHashesEqual:true,existingHistoryContentVerified:plan.existingHistoryContentVerified+plan.missingHistoryContent.length};await fs.writeFile(new URL('media-result.json',out),JSON.stringify(result,null,2)+'\n');console.log(result);
}else throw Error('plan|delete');
