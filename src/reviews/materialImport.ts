export type MaterialType = "script" | "reference" | "image" | "audio" | "video";

export type MaterialPurpose =
  | "main_script"
  | "supplemental_script"
  | "general_reference"
  | "visual_reference"
  | "a_roll"
  | "b_roll"
  | "narration"
  | "background_music"
  | "sound_effect"
  | "cover";

export interface MaterialPurposeOption {
  label: string;
  value: MaterialPurpose;
}

const purposeLabels: Record<MaterialPurpose, string> = {
  main_script: "主脚本",
  supplemental_script: "补充脚本",
  general_reference: "一般参考",
  visual_reference: "视觉参考",
  a_roll: "A-roll / 人工出镜视频",
  b_roll: "B-roll / 视频参考",
  narration: "旁白 / 人声",
  background_music: "背景音乐",
  sound_effect: "音效",
  cover: "封面素材",
};

const purposeOptions: Record<MaterialType, readonly MaterialPurpose[]> = {
  script: ["main_script", "supplemental_script", "general_reference"],
  reference: ["general_reference", "visual_reference", "b_roll"],
  image: ["visual_reference", "cover", "general_reference"],
  audio: ["narration", "background_music", "sound_effect", "general_reference"],
  video: ["b_roll", "a_roll", "visual_reference", "general_reference"],
};

const extensionPattern = (file: File, extensions: readonly string[]) => {
  const name = file.name.toLowerCase();
  return extensions.some((extension) => name.endsWith(extension)) || extensions.some((extension) => file.type.toLowerCase().startsWith(extension));
};

export function materialTypeForFile(file: File): MaterialType {
  if (extensionPattern(file, [".md", ".markdown", ".txt", "text/markdown", "text/plain"])) return "script";
  if (extensionPattern(file, [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", "image/"])) return "image";
  if (extensionPattern(file, [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", "audio/"])) return "audio";
  if (extensionPattern(file, [".mp4", ".mov", ".webm", ".m4v", ".avi", "video/"])) return "video";
  return "reference";
}

export function isSupportedManualARollVideo(sourcePath: string, materialType: string, mimeType: string): boolean {
  return materialType === "video" && /\.(mp4|mov|webm)$/i.test(sourcePath) && (mimeType === "application/octet-stream" || mimeType.toLowerCase().startsWith("video/"));
}

export function isSupportedManualAudio(sourcePath: string, materialType: string, mimeType: string): boolean {
  return materialType === "audio" && /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(sourcePath) && (mimeType === "application/octet-stream" || mimeType.toLowerCase().startsWith("audio/"));
}

export function materialPurposeLabel(purpose: MaterialPurpose): string {
  return purposeLabels[purpose];
}

function extensionFor(sourcePath: string, materialType: MaterialType): string {
  const extension = /\.[a-z0-9]+$/i.exec(sourcePath)?.[0]?.toLowerCase();
  if (extension) return extension;
  return materialType === "script" ? ".md" : materialType === "image" ? ".png" : materialType === "audio" ? ".mp3" : materialType === "video" ? ".mp4" : ".bin";
}

export function canonicalMaterialName(purpose: MaterialPurpose, sourcePath: string, materialType: MaterialType, ordinal = 1): string {
  const extension = extensionFor(sourcePath, materialType);
  if (purpose === "main_script") return "script.md";
  if (purpose === "visual_reference") return `actor${extension}`;
  if (purpose === "cover") return `cover${extension}`;
  if (purpose === "a_roll") return `a-shot-${String(ordinal).padStart(3, "0")}${extension}`;
  if (purpose === "b_roll") return `b-shot-${String(ordinal).padStart(3, "0")}${extension}`;
  if (purpose === "narration") return `narration-${String(ordinal).padStart(3, "0")}${extension}`;
  if (purpose === "background_music") return `bgm-${String(ordinal).padStart(3, "0")}${extension}`;
  if (purpose === "sound_effect") return `sfx-${String(ordinal).padStart(3, "0")}${extension}`;
  return sourcePath.split(/[\\/]/).pop() || `material${extension}`;
}

export function materialPurposeOptions(materialType: MaterialType, allowMainScript: boolean): MaterialPurposeOption[] {
  return purposeOptions[materialType]
    .filter((purpose) => allowMainScript || purpose !== "main_script")
    .map((value) => ({ label: materialPurposeLabel(value), value }));
}

export function defaultMaterialPurpose(materialType: MaterialType, allowMainScript: boolean): MaterialPurpose {
  const options = materialPurposeOptions(materialType, allowMainScript);
  return options[0]?.value ?? "general_reference";
}
