import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

function isSafeRelativePath(relativePath: string): boolean {
  return relativePath.length > 0 && !relativePath.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..");
}

export function localArtifactUrl(episodeId: string, relativePath: string, expectedSha256?: string): string | null {
  if (!episodeId || !isSafeRelativePath(relativePath)) return null;
  return `/_local-artifact?${new URLSearchParams({ episode: episodeId, path: relativePath, ...(expectedSha256 ? { sha256: expectedSha256 } : {}) }).toString()}`;
}

export function artifactPreviewKind(relativePath: string): "image" | "video" | "audio" | null {
  const path = relativePath.toLowerCase();
  if (/\.(avif|gif|jpe?g|png|svg|webp)$/.test(path)) return "image";
  if (/\.(mp4|mov|webm)$/.test(path)) return "video";
  if (/\.(aac|m4a|mp3|ogg|opus|wav)$/.test(path)) return "audio";
  return null;
}

export function useLocalArtifactBlob(source: string | null) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let objectUrl = "";
    let isCurrent = true;
    async function load() {
      if (!source) throw new Error("本地产物路径无效。");
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error("需要 Owner 登录会话。");
      const response = await fetch(source, { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) throw new Error("无法读取本地产物。");
      objectUrl = URL.createObjectURL(await response.blob());
      if (isCurrent) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }
    setUrl("");
    setError("");
    void load().catch((cause: unknown) => { if (isCurrent) setError(cause instanceof Error ? cause.message : "无法读取本地产物。"); });
    return () => { isCurrent = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
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
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw new Error("需要 Owner 登录会话。");
      const response = await fetch(source, { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) throw new Error("无法读取文本产物。");
      const nextContent = await response.text();
      if (isCurrent) setContent(nextContent);
    }
    setContent("");
    setError("");
    void loadText().catch((cause: unknown) => { if (isCurrent) setError(cause instanceof Error ? cause.message : "无法读取文本产物。"); });
    return () => { isCurrent = false; };
  }, [source]);
  return { content, error };
}
