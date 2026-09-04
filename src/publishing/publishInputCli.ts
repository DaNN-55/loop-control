import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { nonNegativeIntegerEnvironment, requiredArgument, requiredEnvironment } from "../worker/runtimeEnvironment.js";
import { coverImageExtension, coverInputPath } from "./coverImage.js";
import { loadPublishContext } from "./publishContext.js";

const episodeId = requiredArgument(process.argv[2], "episode ID");
const artifactType = requiredArgument(process.argv[3], "publish input type");
const relativePath = requiredArgument(process.argv[4], "publish input path");
if (artifactType !== "cover" && artifactType !== "metadata") throw new Error("发布输入类型只能是 cover 或 metadata。");
const supabase = createClient(requiredEnvironment("SUPABASE_URL"), requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const context = await loadPublishContext({ allowedStages: ["qc_passed"], episodeId, mediaLibraryMountPath: requiredEnvironment("MEDIA_LIBRARY_MOUNT_PATH"), mediaLibraryMinimumFreeBytes: nonNegativeIntegerEnvironment("MEDIA_LIBRARY_MIN_FREE_BYTES"), supabase });
const absolutePath = await realpath(resolve(context.assetRoot, relativePath));
const episodeDirectory = await realpath(resolve(context.assetRoot, "episodes", context.episodeId));
const pathFromEpisode = relative(episodeDirectory, absolutePath);
const contents = await readFile(absolutePath);
const coverExtension = artifactType === "cover" ? coverImageExtension(contents) : null;
if (artifactType === "cover" && !coverExtension) throw new Error("封面必须是有效的 JPG、PNG 或 WebP 文件。");
const expectedPath = artifactType === "cover" ? coverInputPath(context.episodeId, coverExtension!) : `episodes/${context.episodeId}/publish-input/metadata-v1.json`;
if (pathFromEpisode.startsWith("..") || pathFromEpisode === "" || relativePath !== expectedPath) throw new Error("发布输入必须位于本 Episode 的固定 publish-input 路径。");
if (artifactType === "metadata") { const parsed: unknown = JSON.parse(contents.toString("utf8")); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("发布元数据必须是 JSON 对象。"); }
const { error } = await supabase.rpc("record_publish_input", { p_episode_id: context.episodeId, p_artifact_type: artifactType, p_relative_path: relativePath, p_sha256: createHash("sha256").update(contents).digest("hex"), p_file_size: contents.byteLength });
if (error) throw new Error(`无法登记发布输入：${error.message}`);
process.stdout.write(`${JSON.stringify({ episodeId: context.episodeId, artifactType, relativePath, status: "recorded" })}\n`);
