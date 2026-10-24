import * as fs from "node:fs/promises";
import{resolve,relative,isAbsolute,parse}from"node:path";
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
  if(!await deletionParents(resolvedRoot))return false;
  const stagingPath = resolve(resolvedRoot, "episodes", ".deletion-staging", episodeId);
  let stagedStat;
  try {
    stagedStat = await fs.lstat(stagingPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  if (stagedStat.isSymbolicLink() || !stagedStat.isDirectory()) throw new Error("删除暂存目录不是安全目录。");
  const resolvedStagingPath = await fs.realpath(stagingPath);
  if (!isDescendant(resolvedRoot, resolvedStagingPath)) throw new Error("删除暂存目录超出资产根。");
  await fs.rm(resolvedStagingPath, { force: false, recursive: true });
  return true;
}
