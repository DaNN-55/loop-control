// Official direct APIs, checked 2026-10-27. Shared by configuration and execution.
export const videoProviders = {
  volcengine: { adapter: 'seedance_video', label: '火山方舟 Seedance', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seedance-2-0-260128', 'doubao-seedance-2-5-260628'], minDuration: 4, maxDuration: 15 },
  minimax: { adapter: 'minimax_video', label: 'MiniMax H3', endpoint: 'https://api.minimax.io', models: ['MiniMax-H3'], minDuration: 4, maxDuration: 15 },
  kling: { adapter: 'kling_video', label: '可灵 Kling 3.0', endpoint: 'https://api-singapore.klingai.com', models: ['kling-v3'], minDuration: 3, maxDuration: 15 },
} as const;
export type VideoProvider = keyof typeof videoProviders;
export function isVideoProvider(value: string): value is VideoProvider { return Object.hasOwn(videoProviders, value); }
export const videoAdapters: readonly string[] = Object.values(videoProviders).map(p => p.adapter);
