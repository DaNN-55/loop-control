import {execFileSync} from 'node:child_process';
import {lstat,readdir,realpath,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';

// Keep reusable compiler packs, never project/media/preview files. This is an
// idle-time retention target, not a hard limit while several editors are open.
export async function pruneOpenChatCutCache(root,{maxBytes=512*1024*1024,maxEntries=2}={}) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||!Number.isSafeInteger(maxEntries)||maxEntries<0)throw Error('Invalid cache retention limits');
  try {
    root=resolve(root);
    const cache=join(root,'node_modules/.cache/webpack');
    for(const path of [root,join(root,'node_modules'),join(root,'node_modules/.cache'),cache]) {
      const stat=await lstat(path);
      if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path)return {status:'skipped',reason:'unsafe-path'};
    }
    // A Studio or export process can reopen a pack even when no fd is open.
    // All managed SDK children use the SDK root as their working directory.
    if(pids(['-a','-d','cwd','-Fp',root]).some(pid=>pid!==process.pid)||pids(['-Fp','+D',cache]).length)return {status:'skipped',reason:'in-use'};
    const entries=[];
    for(const version of await readdir(cache)) {
      if(!/^remotion-(production|development)-[\d.]+$/.test(version))continue;
      const directory=join(cache,version);
      await safeStat(directory,true);
      for(const hash of await readdir(directory)) {
        if(!/^[a-f0-9]{32}$/.test(hash))continue;
        const path=join(directory,hash),stat=await safeStat(path,true);
        const tree=await inventory(path);
        entries.push({path,device:stat.dev,inode:stat.ino,...tree});
      }
    }
    entries.sort((a,b)=>b.modified-a.modified||a.path.localeCompare(b.path));
    let keptBytes=0,keptEntries=0,removedBytes=0;
    const removed=[];
    for(const entry of entries) {
      if(keptEntries<maxEntries&&keptBytes+entry.bytes<=maxBytes) {keptEntries++;keptBytes+=entry.bytes;continue;}
      // Recheck after the initial walk. A changing or opened cache is left
      // alone; pruning is optional and must not prevent editing or export.
      const stat=await safeStat(entry.path,true),current=await inventory(entry.path);
      if(stat.dev!==entry.device||stat.ino!==entry.inode||current.fingerprint!==entry.fingerprint||pids(['-a','-d','cwd','-Fp',root]).some(pid=>pid!==process.pid)||pids(['-Fp','+D',cache]).length)return {status:'skipped',reason:'changed-or-in-use',removed,removedBytes};
      await rm(entry.path,{recursive:true});
      removed.push(entry.path);removedBytes+=entry.bytes;
    }
    return {status:removed.length?'pruned':'unchanged',removed,removedBytes,keptBytes,keptEntries};
  } catch(error) {
    if(error.code==='ENOENT')return {status:'absent'};
    // Fail closed on unsupported platforms, lsof errors, aliases or special
    // files. No speculative deletion, and no disruption to the actual work.
    return {status:'skipped',reason:error.message};
  }
}

function pids(args) {
  let output;
  try {output=execFileSync('/usr/sbin/lsof',['-nP',...args],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']});}
  catch(error) {
    // macOS lsof can return 1 alongside valid matching descriptors.
    if(error.status!==1||String(error.stderr??'').trim())throw Error('Cache usage could not be verified');
    output=String(error.stdout??'');
  }
  return output.split('\n').filter(line=>/^p\d+$/.test(line)).map(line=>Number(line.slice(1)));
}

async function safeStat(path,directory) {
  const stat=await lstat(path);
  if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))throw Error('Unsafe cache entry');
  return stat;
}

async function inventory(root) {
  let bytes=0,modified=0;const rows=[];
  async function walk(path,depth) {
    if(depth>16||rows.length>10000)throw Error('Cache inventory limit exceeded');
    for(const name of (await readdir(path)).sort()) {
      const child=join(path,name),stat=await lstat(child);
      if(stat.isSymbolicLink())throw Error('Unsafe cache entry');
      rows.push([child,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs]);
      modified=Math.max(modified,stat.mtimeMs);
      if(stat.isDirectory())await walk(child,depth+1);
      else {await safeStat(child,false);bytes+=stat.blocks*512;}
    }
  }
  await walk(root,0);
  return {bytes,modified,fingerprint:JSON.stringify(rows)};
}
