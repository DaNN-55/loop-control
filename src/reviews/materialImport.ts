export type MaterialType = "script" | "reference" | "image" | "audio" | "video";

export type MaterialPurpose =
  | "main_script"
  | "supplemental_script"
  | "general_reference"
  | "visual_reference"
  | "b_roll"
  | "narration"
  | "background_music"
  | "sound_effect";

export interface MaterialPurposeOption {
  label: string;
  value: MaterialPurpose;
}

const purposeLabels: Record<MaterialPurpose, string> = {
  main_script: "主脚本",
  supplemental_script: "补充脚本",
  general_reference: "一般参考",
  visual_reference: "视觉参考",
  b_roll: "B-roll / 视频参考",
  narration: "旁白 / 人声",
  background_music: "背景音乐",
  sound_effect: "音效",
};

const purposeOptions: Record<MaterialType, readonly MaterialPurpose[]> = {
  script: ["main_script", "supplemental_script", "general_reference"],
  reference: ["general_reference", "visual_reference", "b_roll"],
  image: ["visual_reference", "general_reference"],
  audio: ["narration", "background_music", "sound_effect", "general_reference"],
  video: ["b_roll", "visual_reference", "general_reference"],
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

export function materialPurposeLabel(purpose: MaterialPurpose): string {
  return purposeLabels[purpose];
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
