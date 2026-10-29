// Retired identities remain valid in immutable historical records only.
export function isRetiredProvider(provider:string):boolean{return provider==='cloudflare'||provider==='google_tts';}
export const retiredProviderMessage='此 Provider 已停用，请为新生产单选择其他服务；历史记录保留。';
