export function workspaceSettingsFingerprint(value:unknown){return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
/** A tab draft only belongs to the saved settings it started from. */
export function restoreWorkspaceSettingsDraft<T>(key:string,baseline:T):T {
 try {const stored=JSON.parse(sessionStorage.getItem(key)??'null');if(stored?.baseline===workspaceSettingsFingerprint(baseline))return stored.value;return baseline;}catch{return baseline;}
}
export function storeWorkspaceSettingsDraft<T>(key:string,baseline:T,value:T){
 try{sessionStorage.setItem(key,JSON.stringify({baseline:workspaceSettingsFingerprint(baseline),value}));}catch{/* The current form remains usable without browser storage. */}
}

/** Older forms auto-stored inherited settings too, so restoring them requires an explicit action. */
export function readWorkspaceLegacySettingsDraft<T extends object>(key:string,baseline:T):T|null {
 try{const stored=JSON.parse(sessionStorage.getItem(key+':legacy-settings')??sessionStorage.getItem(key)??'null');return stored&&typeof stored==='object'&&!Array.isArray(stored)&&stored.baseline===undefined?{...baseline,...stored}:null;}catch{return null;}
}
export function retainWorkspaceLegacySettingsDraft(key:string,value:unknown){
 try{if(value)sessionStorage.setItem(key+':legacy-settings',JSON.stringify(value));else sessionStorage.removeItem(key+':legacy-settings');}catch{/* Optional recovery copy. */}
}
