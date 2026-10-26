import{readFileSync,lstatSync,realpathSync}from'node:fs';import{resolve,relative,isAbsolute,join}from'node:path';import{createHash}from'node:crypto';
export const digest=b=>createHash('sha256').update(b).digest('hex');
export function archiveCopies(text){
 const result=[];for(const m of text.matchAll(/^COPY (public|local_identity|loop_internal)\.([a-z_][a-z0-9_]*) \(([^\n]+)\) FROM stdin;\n([\s\S]*?)^\\\.\n/gm)){
  if(!/^[a-z_][a-z0-9_]*(?:, [a-z_][a-z0-9_]*)*$/.test(m[3]))throw Error('Unsupported archive columns');const rows=m[4].split('\n').slice(0,-1).sort();result.push({table:m[1]+'.'+m[2],columns:m[3],rows:rows.length,sha256:digest(Buffer.from(rows.join('\n'))),records:m[4]});
 }if(!result.length||new Set(result.map(x=>x.table)).size!==result.length)throw Error('Unsupported or duplicate archive tables');return result;
}
export function archiveSequences(text){return [...text.matchAll(/^SELECT pg_catalog\.setval\('((?:public|local_identity|loop_internal)\.[a-z_][a-z0-9_]*)', ([0-9]+), (true|false)\);$/gm)].map(m=>({name:m[1],value:m[2],isCalled:m[3]==='true'}));}
export function readNativeBackup(path,expected={}){
 if(realpathSync(path)!==path||!lstatSync(path).isDirectory())throw Error('Unsafe archive directory');
 for(const file of ['manifest.json','business.dump']){const p=join(path,file),s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||realpathSync(p)!==p)throw Error('Unsafe archive file');}
 const m=JSON.parse(readFileSync(join(path,'manifest.json')));if(!['loop-native-backup/v1','loop-native-backup/v2'].includes(m.version)||!m.inventory||!Array.isArray(m.media)||!/^loop_[a-z0-9_]+$/.test(m.database)||!/^[0-9a-f-]{36}$/.test(m.jobId)||!isAbsolute(m.mediaRoot)||!m.archiveSha256?.match(/^[a-f0-9]{64}$/))throw Error('Archive format mismatch');
 for(const[k,v]of Object.entries(expected))if(m[k]!==v)throw Error('Archive identity mismatch');
 for(const file of ['manifest.json','business.dump']){const s=lstatSync(join(path,file));if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Unsafe archive file');}
 if(digest(readFileSync(join(path,'business.dump')))!==m.archiveSha256)throw Error('Archive digest mismatch');
 const seen=new Set();for(const f of m.media){if(typeof f.path!=='string'||!f.path||isAbsolute(f.path)||f.path.split(/[\\/]/).some(s=>!s||s==='.'||s==='..')||seen.has(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Unsafe media manifest');seen.add(f.path);const p=resolve(path,'media',f.path),rel=relative(join(path,'media'),p),s=lstatSync(p);if(rel.startsWith('..')||isAbsolute(rel)||realpathSync(p)!==p||!s.isFile()||s.nlink!==1||s.size!==f.bytes||digest(readFileSync(p))!==f.sha256)throw Error('Archived media mismatch');}
 return m;
}
