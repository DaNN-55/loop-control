export interface RuntimeLogEntry{
 id:string;level:'INFO'|'WARN'|'ERROR';occurredAt:string|null;time:string|null;episodeId:string|null;episodeName:string|null;operationId:string|null;requestId:string|null;
 source:string;message:string;raw:string;sourceFile:string;line:number|null;explanation:{what:string;result:string;reason?:string;suggestion?:string};
}
export interface RuntimeLogReport{observedAt:string;entries:RuntimeLogEntry[];truncated:boolean;sourceAvailable:boolean;maxEntries:number}
export interface LogStorageState{activeDirectory:string;configuredDirectory:string;defaultDirectory:string;pending:boolean;warning:string|null}
export interface LogStoragePort{read:()=>LogStorageState;save:(path:string)=>LogStorageState;choose?:()=>Promise<{path?:string;cancelled?:boolean}>}
export function parseLogStorageState(value:unknown):LogStorageState{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('日志位置返回格式无效，请重新读取。');
 const state=value as Record<string,unknown>;
 if(['activeDirectory','configuredDirectory','defaultDirectory'].some(key=>typeof state[key]!=='string')||typeof state.pending!=='boolean'||state.warning!==null&&typeof state.warning!=='string')throw Error('日志位置返回格式无效，请重新读取。');
 return state as unknown as LogStorageState;
}
