import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const previewCacheDurationMs = 29 * 60_000;
const localArtifactPreviewLoads = new Map<string, { expiresAt: number; load: Promise<string> }>();
const localArtifactTextLoads = new Map<string, Promise<string>>();

export function clearLocalArtifactCache(): void {
  localArtifactPreviewLoads.clear();
  localArtifactTextLoads.clear();
}

function isSafeRelativePath(relativePath: string): boolean {
  return relativePath.length > 0 && !relativePath.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..");
}

export function localArtifactUrl(episodeId: string, relativePath: string, expectedSha256?: string): string | null {
  if (!episodeId || !isSafeRelativePath(relativePath)) return null;
  return `/_local-artifact?${new URLSearchParams({ episode: episodeId, path: relativePath, ...(expectedSha256 ? { sha256: expectedSha256 } : {}) }).toString()}`;
}

export function localArtifactThumbnailUrl(episodeId: string, relativePath: string, expectedSha256?: string): string | null {
  const source = localArtifactUrl(episodeId, relativePath, expectedSha256);
  return source ? `${source}&thumbnail=keyframe` : null;
}

export function artifactPreviewKind(relativePath: string): "image" | "video" | "audio" | null {
  const path = relativePath.toLowerCase();
  if (/\.(avif|gif|jpe?g|png|svg|webp)$/.test(path)) return "image";
  if (/\.(mp4|mov|webm)$/.test(path)) return "video";
  if (/\.(aac|m4a|mp3|ogg|opus|wav)$/.test(path)) return "audio";
  return null;
}

async function loadLocalArtifactPreview(source: string): Promise<string> {
  const cached = localArtifactPreviewLoads.get(source);
  if (cached && cached.expiresAt > Date.now()) return cached.load;
  localArtifactPreviewLoads.delete(source);
  const load = (async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session) throw new Error("需要 Owner 登录会话。");
    const response = await fetch(source, { headers: { Authorization: `Bearer ${data.session.access_token}` }, method: "POST" });
    if (!response.ok) throw new Error("无法读取本地产物。");
    const body = await response.json() as { url?: unknown };
    if (typeof body.url !== "string" || !body.url.startsWith("/_local-artifact?ticket=")) throw new Error("无法读取本地产物。");
    return body.url;
  })();
  if (localArtifactPreviewLoads.size >= 100) localArtifactPreviewLoads.delete(localArtifactPreviewLoads.keys().next().value!);
  localArtifactPreviewLoads.set(source, { expiresAt: Date.now() + previewCacheDurationMs, load });
  try {
    return await load;
  } catch (error) {
    if (localArtifactPreviewLoads.get(source)?.load === load) localArtifactPreviewLoads.delete(source);
    throw error;
  }
}

async function loadLocalArtifactText(source: string): Promise<string> {
  const cached = localArtifactTextLoads.get(source);
  if (cached) return cached;
  const load = (async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session) throw new Error("需要 Owner 登录会话。");
    const response = await fetch(source, { headers: { Authorization: `Bearer ${data.session.access_token}` } });
    if (!response.ok) throw new Error("无法读取文本产物。");
    return response.text();
  })();
  if (localArtifactTextLoads.size >= 100) localArtifactTextLoads.delete(localArtifactTextLoads.keys().next().value!);
  localArtifactTextLoads.set(source, load);
  try {
    return await load;
  } catch (error) {
    if (localArtifactTextLoads.get(source) === load) localArtifactTextLoads.delete(source);
    throw error;
  }
}

export function useLocalArtifactBlob(source: string | null) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let isCurrent = true;
    async function load() {
      if (!source) throw new Error("本地产物路径无效。");
      const previewUrl = await loadLocalArtifactPreview(source);
      if (isCurrent) setUrl(previewUrl);
    }
    setUrl("");
    setError("");
    void load().catch((cause: unknown) => { if (isCurrent) setError(cause instanceof Error ? cause.message : "无法读取本地产物。"); });
    return () => { isCurrent = false; };
  }, [source]);
  return { error, url };
}

export function useLocalArtifactText(source: string | null) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let isCurrent = true;
    async function loadText() {
      if (!source) throw new Error("文本产物路径无效。");
      const nextContent = await loadLocalArtifactText(source);
      if (isCurrent) setContent(nextContent);
    }
    setContent("");
    setError("");
    void loadText().catch((cause: unknown) => { if (isCurrent) setError(cause instanceof Error ? cause.message : "无法读取文本产物。"); });
    return () => { isCurrent = false; };
  }, [source]);
  return { content, error };
}
