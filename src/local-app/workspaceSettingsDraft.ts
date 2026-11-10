import type {ProductionSelection} from '../productionSelection';
export interface SpeechSettings {selection:ProductionSelection|null;voice:string;languageCode:string;speakingRate:number}
function isSpeechSettings(value:unknown):value is SpeechSettings {
 if(!value||typeof value!=='object')return false;
 const fields=value as Record<string,unknown>,selection=fields.selection;
 if(typeof fields.voice!=='string'||typeof fields.languageCode!=='string'||typeof fields.speakingRate!=='number'||!Number.isFinite(fields.speakingRate))return false;
 if(selection===null)return true;
 if(!selection||typeof selection!=='object'||Array.isArray(selection))return false;
 const choice=selection as Record<string,unknown>;
 return choice.capability==='speech'&&typeof choice.provider==='string'&&typeof choice.adapter==='string'&&['model','preset','connectionVersionId'].every(key=>choice[key]===undefined||typeof choice[key]==='string');
}
export function workspaceSettingsFingerprint(value:unknown){return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
/** A tab draft only belongs to the saved settings it started from. */
export function restoreWorkspaceSettingsDraft<T extends SpeechSettings>(key:string,baseline:T):T {
 try {const stored=JSON.parse(sessionStorage.getItem(key)??'null');if(stored?.baseline===workspaceSettingsFingerprint(baseline)&&isSpeechSettings(stored.value))return {...baseline,...stored.value};return baseline;}catch{return baseline;}
}
export function storeWorkspaceSettingsDraft<T>(key:string,baseline:T,value:T){
 try{sessionStorage.setItem(key,JSON.stringify({baseline:workspaceSettingsFingerprint(baseline),value}));}catch{/* The current form remains usable without browser storage. */}
}
