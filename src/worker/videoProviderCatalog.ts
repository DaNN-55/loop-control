// Official direct APIs, checked 2026-10-27. Shared by configuration and execution.
export const klingOmniModel='kling-v3-omni';
export const klingOmniPath='/v1/videos/omni-video';
export const videoProviders = {
  volcengine: { adapter: 'seedance_video', label: '火山方舟 Seedance', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seedance-2-0-260128', 'doubao-seedance-2-5-260628'], minDuration: 4, maxDuration: 15 },
  minimax: { adapter: 'minimax_video', label: 'MiniMax H3', endpoint: 'https://api.minimax.io', models: ['MiniMax-H3','MiniMax-H3-Highspeed','MiniMax-H3-Lite'], minDuration: 4, maxDuration: 15 },
  kling: { adapter: 'kling_video', label: '可灵 Kling 3.0', endpoint: 'https://api-singapore.klingai.com', models: ['kling-v3',klingOmniModel], minDuration: 3, maxDuration: 15 },
} as const;
export type VideoProvider = keyof typeof videoProviders;
export const minimaxEndpoints={cn:'https://api.minimax.cn',international:'https://api.minimax.io'} as const;
export type MiniMaxRegion=keyof typeof minimaxEndpoints;
export function isVideoProvider(value: string): value is VideoProvider { return Object.hasOwn(videoProviders, value); }
export const videoAdapters: readonly string[] = Object.values(videoProviders).map(p => p.adapter);

export const minimaxVideoModels:Readonly<Record<string,{resolutions:readonly string[];cn:Readonly<Record<string,number>>;international:Readonly<Record<string,number>>;imageCn:number;imageInternational:number}>>={
 'MiniMax-H3':{resolutions:['768P','2K'],cn:{'768P':.5,'2K':.8},international:{'768P':.08,'2K':.13},imageCn:.2,imageInternational:.04},
 'MiniMax-H3-Highspeed':{resolutions:['768P','480P'],cn:{'768P':.4,'480P':.26},international:{'768P':.06,'480P':.04},imageCn:.2,imageInternational:.03},
 'MiniMax-H3-Lite':{resolutions:['768P','480P'],cn:{'768P':.26,'480P':.16},international:{'768P':.04,'480P':.025},imageCn:.13,imageInternational:.02},
};
export function minimaxVideoResolution(model:string,value:unknown='768P'):string{
 if(typeof value!=='string'||!Object.hasOwn(minimaxVideoModels,model)||!minimaxVideoModels[model].resolutions.includes(value))throw Error('MiniMax 模型或分辨率无效。');
 return value;
}
