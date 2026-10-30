export const imageSizes = ['864x1536', '1536x864', '1024x1024', '1024x1536', '1536x1024'] as const;
export interface ImageGenerationSettings {
  size: typeof imageSizes[number];
  quality: 'auto' | 'low' | 'medium' | 'high';
  count: 1 | 2 | 4;
}
export function isImageGenerationSettings(value: unknown): value is ImageGenerationSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as ImageGenerationSettings;
  return imageSizes.includes(s.size) && ['auto', 'low', 'medium', 'high'].includes(s.quality) && [1, 2, 4].includes(s.count);
}
