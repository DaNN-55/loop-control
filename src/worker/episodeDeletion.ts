import * as fs from "node:fs/promises";
import{resolve,relative,isAbsolute,parse}from"node:path";
import {deletionFileFingerprint,verifyEpisodeDeletionTarget,type EpisodeDeletionTarget,type DeletionFile} from '../local-app/episodeDeletionTargets.js';

async function exactFile(file:DeletionFile,path:string,links=1n){
 const current=await deletionFileFingerprint(path,links);if(current.identity.dev!==file.identity.dev||current.identity.ino!==file.identity.ino||current.sha256!==file.sha256||current.bytes!==file.bytes)throw Error('删除文件身份或指纹已变化：'+path);
}
export async function stageConfirmedEpisodeFiles(target:EpisodeDeletionTarget){
 await verifyEpisodeDeletionTarget(target,'original');
 for(const file of target.files??[]){
  const original=await optionalEntry(file.path),staged=await optionalEntry(file.stagingPath);
  if(staged){if(original){await exactFile(file,file.path,2n);await exactFile(file,file.stagingPath,2n);await fs.unlink(file.path);}else await exactFile(file,file.stagingPath);continue;}
  if(!original)throw Error('已确认文件缺失：'+file.path);await exactFile(file,file.path);
  // Hard-link publication fails atomically if an unknown destination appears.
  // The durable manifest also recovers the link-before-unlink crash window.
  await fs.link(file.path,file.stagingPath);await exactFile(file,file.path,2n);await exactFile(file,file.stagingPath,2n);await fs.unlink(file.path);
 }
}
export async function restoreConfirmedEpisodeFiles(target:EpisodeDeletionTarget){
 await verifyEpisodeDeletionTarget(target,'staged');
 for(const file of [...target.files??[]].reverse()){
  if(!await optionalEntry(file.stagingPath)){await exactFile(file,file.path);continue;}
  if(await optionalEntry(file.path)){
   try{await exactFile(file,file.path);continue;}catch{/* A matching original plus an unknown staging conflict was never moved. */}
   try{await exactFile(file,file.path,2n);await exactFile(file,file.stagingPath,2n);await fs.unlink(file.stagingPath);continue;}catch{throw Error('原文件位置已被占用，未覆盖：'+file.path);}
  }
  await exactFile(file,file.stagingPath);await fs.link(file.stagingPath,file.path);await exactFile(file,file.stagingPath,2n);await exactFile(file,file.path,2n);await fs.unlink(file.stagingPath);
 }
}
export async function finalizeConfirmedEpisodeFiles(target:EpisodeDeletionTarget){
 await verifyEpisodeDeletionTarget(target,'staged');
 for(const file of target.files??[]){
  if(await optionalEntry(file.path))throw Error('已删除文件原位置重新出现，未扩大清理范围。');
  if(!await optionalEntry(file.stagingPath))continue;await exactFile(file,file.stagingPath);await fs.unlink(file.stagingPath);
 }
 for(const directory of [...target.directories??[]].reverse()){
  const actual=await optionalEntry(directory.path);if(!actual)continue;
  if(!actual.isDirectory()||actual.isSymbolicLink()||String(actual.dev)!==directory.identity.dev||String(actual.ino)!==directory.identity.ino)throw Error('已确认空目录身份已变化。');
  await removeEmptyCleanupDirectory(directory.path);
 }
 if(!await optionalEntry(target.path)){
  for(const link of target.links??[]){
   const parent=await safeCleanupDirectory(link.parent),current=await optionalEntry(link.path);if(!current)continue;
   if(!parent||String(parent.dev)!==link.parentIdentity.dev||String(parent.ino)!==link.parentIdentity.ino||!current.isSymbolicLink()||String(current.dev)!==link.identity.dev||String(current.ino)!==link.identity.ino||await fs.readlink(link.path)!==link.value)throw Error('已确认标题链接身份已变化，未清理。');
   await fs.unlink(link.path);
  }
  for(const container of target.cleanupContainers??[]){const current=await safeCleanupDirectory(container.path);if(!current)continue;if(String(current.dev)!==container.identity.dev||String(current.ino)!==container.identity.ino)throw Error('已确认空容器身份已变化，未清理。');await removeEmptyCleanupDirectory(container.path);}
 }
}
const isEpisodeId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function isDescendant(root:string,path:string){const r=relative(root,path);return !!r&&!r.startsWith("..")&&!isAbsolute(r);}
function isFilesystemRoot(path:string){return parse(resolve(path)).root===resolve(path);}
async function ensureDirectoryWithinRoot(root: string, directory: string): Promise<string> {
  if (!isDescendant(root, directory)) throw new Error("目录超出资产根。");
  try {
    const existing = await fs.lstat(directory);
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error("目录不是安全目录。");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    try {
      await fs.mkdir(directory);
    } catch (mkdirError) {
      if (!(mkdirError instanceof Error && "code" in mkdirError && mkdirError.code === "EEXIST")) throw mkdirError;
    }
  }
  const resolvedDirectory = await fs.realpath(directory);
  if (!isDescendant(root, resolvedDirectory)) throw new Error("目录超出资产根。");
  return resolvedDirectory;
}

export async function stageLocalEpisodeDirectoryForDeletion(assetRoot: string, episodeId: string): Promise<{ existed: boolean; path: string; stagingPath: string }> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  const resolvedRoot = await fs.realpath(assetRoot);
  if (isFilesystemRoot(resolvedRoot)) throw new Error("资产根不能是文件系统根目录。");
  const episodesDirectory = resolve(resolvedRoot, "episodes");
  const episodeDirectory = resolve(episodesDirectory, episodeId);
  let episodesStat;
  try {
    episodesStat = await fs.lstat(episodesDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { existed: false, path: episodeDirectory, stagingPath: resolve(episodesDirectory, ".deletion-staging", episodeId) };
    throw error;
  }
  if (episodesStat.isSymbolicLink() || !episodesStat.isDirectory()) throw new Error("目录不是安全目录。");

  const stagingRoot = await ensureDirectoryWithinRoot(episodesDirectory, resolve(episodesDirectory, ".deletion-staging"));
  const stagingPath = resolve(stagingRoot, episodeId);
  let stagedStat;
  try {
    stagedStat = await fs.lstat(stagingPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    stagedStat = null;
  }
  if (stagedStat && (stagedStat.isSymbolicLink() || !stagedStat.isDirectory())) throw new Error("删除暂存目录不是安全目录。");

  let episodeStat;
  try {
    episodeStat = await fs.lstat(episodeDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      if (stagedStat) return { existed: true, path: episodeDirectory, stagingPath };
      return { existed: false, path: episodeDirectory, stagingPath };
    }
    throw error;
  }
  if (episodeStat.isSymbolicLink() || !episodeStat.isDirectory()) throw new Error("目录不是安全目录。");
  if (stagedStat) throw new Error("Episode 已有待删除的暂存目录。");

  const resolvedEpisodeDirectory = await fs.realpath(episodeDirectory);
  if (!isDescendant(resolvedRoot, resolvedEpisodeDirectory)) throw new Error("目录超出资产根。");
  await fs.rename(resolvedEpisodeDirectory, stagingPath);
  return { existed: true, path: episodeDirectory, stagingPath };
}

async function deletionParents(root:string){
 for(const suffix of ['episodes','episodes/.deletion-staging']){const path=resolve(root,suffix);let st;try{st=await fs.lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(path)!==path)throw Error('删除暂存父目录不是安全目录。');}return true;
}

async function optionalEntry(path: string) {
  try { return await fs.lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

async function safeCleanupDirectory(path: string) {
  const stat = await optionalEntry(path);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(path) !== path)) throw Error('清理位置不是安全目录：' + path);
  return stat;
}

async function removeEmptyCleanupDirectory(path: string) {
  if (!await safeCleanupDirectory(path)) return;
  try { await fs.rmdir(path); }
  catch (error) {
    // Shared containers may still contain another Episode, staged deletion or title.
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

async function cleanupDeletedEpisodeContainers(root: string, episodeId: string) {
  const episodes = resolve(root, 'episodes');
  if (!await safeCleanupDirectory(episodes)) return;
  const episode = resolve(episodes, episodeId);
  const navigation = resolve(episodes, '按标题浏览');
  const navigationStat = await safeCleanupDirectory(navigation);
  if (navigationStat) {
    for (const name of await fs.readdir(navigation)) {
      const link = resolve(navigation, name);
      const stat = await optionalEntry(link);
      if (!stat?.isSymbolicLink()) continue;
      const target = await fs.readlink(link);
      if (resolve(navigation, target) !== episode) continue;
      if (await optionalEntry(episode)) throw Error('生产单目录重新出现，请重新检查删除范围。');
      const parent = await safeCleanupDirectory(navigation);
      const current = await optionalEntry(link);
      if (!parent || parent.dev !== navigationStat.dev || parent.ino !== navigationStat.ino || !current?.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino || await fs.readlink(link) !== target) throw Error('标题链接位置已变化，请重试清理。');
      await fs.unlink(link);
    }
    await removeEmptyCleanupDirectory(navigation);
  }
  await removeEmptyCleanupDirectory(resolve(episodes, '.deletion-staging'));
  await removeEmptyCleanupDirectory(episodes);
}

export async function restoreStagedLocalEpisodeDirectory(assetRoot: string, episodeId: string): Promise<void> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  const resolvedRoot = await fs.realpath(assetRoot);
  if(!await deletionParents(resolvedRoot))throw Error("删除暂存目录缺失。");
  const episodesDirectory = resolve(resolvedRoot, "episodes");
  const episodeDirectory = resolve(episodesDirectory, episodeId);
  const stagingPath = resolve(episodesDirectory, ".deletion-staging", episodeId);
  const stagedDirectory = await fs.realpath(stagingPath);
  if (!isDescendant(resolvedRoot, stagedDirectory)) throw new Error("删除暂存目录超出资产根。");
  const existingEpisode = await fs.lstat(episodeDirectory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (existingEpisode) throw new Error("原 Episode 目录已存在，无法恢复删除暂存目录。");
  await fs.rename(stagedDirectory, episodeDirectory);
}

export async function finalizeStagedLocalEpisodeDirectory(assetRoot: string, episodeId: string): Promise<boolean> {
  if (!isEpisodeId(episodeId)) throw new Error("无效的 Episode ID。");
  const resolvedRoot = await fs.realpath(assetRoot);
  if (isFilesystemRoot(resolvedRoot)) throw Error('资产根不能是文件系统根目录。');
  const episodes = resolve(resolvedRoot, 'episodes');
  await safeCleanupDirectory(episodes);
  if (await optionalEntry(resolve(episodes, episodeId))) throw Error('生产单目录重新出现，请重新检查删除范围。');
  let removed = false;
  if (await deletionParents(resolvedRoot)) {
    const stagingPath = resolve(resolvedRoot, "episodes", ".deletion-staging", episodeId);
    const stagedStat = await optionalEntry(stagingPath);
    if (stagedStat) {
      if (stagedStat.isSymbolicLink() || !stagedStat.isDirectory()) throw new Error("删除暂存目录不是安全目录。");
      const resolvedStagingPath = await fs.realpath(stagingPath);
      if (!isDescendant(resolvedRoot, resolvedStagingPath)) throw new Error("删除暂存目录超出资产根。");
      await fs.rm(resolvedStagingPath, { force: false, recursive: true });
      removed = true;
    }
  }
  // Also run on retry when the staged files are already gone but links remain.
  await cleanupDeletedEpisodeContainers(resolvedRoot, episodeId);
  return removed;
}
