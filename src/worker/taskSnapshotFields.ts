// Shared frozen-snapshot field validation at the decoding boundary.
export function artifactManifest(value: unknown, message: string) {
  if (!isRecord(value)) throw new Error(message);
  return { artifactType: requiredString(value.artifact_type, message), relativePath: requiredString(value.relative_path, message), sha256: requiredString(value.sha256, message), fileSize: requiredNonNegativeNumber(value.file_size, message) };
}

export function requiredBoolean(value: unknown, message: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(message);
}

export function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value;
}

export function requiredPositiveNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(message);
  return value;
}

export function requiredNonNegativeNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(message);
  return value;
}

export function stringArray(value: unknown, message: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(message);
  return value as string[];
}

export function requiredSoundtrackKind(value: unknown): "bgm" | "sfx" {
  if (value !== "bgm" && value !== "sfx") throw new Error("声轨任务类型无效。");
  return value;
}

export function requiredShotType(value: unknown): "a_roll" | "b_roll" {
  if (value !== "a_roll" && value !== "b_roll") throw new Error("A-roll 任务镜头类型无效。");
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
