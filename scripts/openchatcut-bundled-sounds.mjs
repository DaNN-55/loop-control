// Host-owned URL adapter; the SDK document and live editor keep the same source.
export function patchBundledSoundSources(code,sources){
 const anchor='export const soundEffectSrc = (id: string): string => `/sound-effects/${id}.mp3`;';
 if(!code.includes(anchor))throw Error('当前 Studio 缺少已验证的内置音效接点。');
 return code.replace(anchor,`export const soundEffectSrc = (id: string): string => (${JSON.stringify(sources)})[id] ?? (()=>{throw Error('未登记的内置音效。');})();`);
}
