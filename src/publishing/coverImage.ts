export type CoverImageExtension = "jpg" | "png" | "webp";

export function coverImageExtension(bytes: Uint8Array): CoverImageExtension | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp";
  return null;
}

export function coverInputPath(episodeId: string, extension: CoverImageExtension): string {
  return `episodes/${episodeId}/publish-input/cover-v1.${extension}`;
}
