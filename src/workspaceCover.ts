/** Current file identity only: no historical execution or approval is carried. */
export interface WorkspaceCoverSource {version:'workspace-cover-source/v1';kind:'material'|'artifact';id:string;sha256:string}
export interface WorkspaceCoverInput {
 source:WorkspaceCoverSource;name:string;
 file?:{relativePath:string;sha256:string;fileSize:number};
 unavailableReason?:string;
}
export function parseWorkspaceCoverSource(value:unknown):WorkspaceCoverSource{
 const v=value as Record<string,unknown>|null;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['version','kind','id','sha256'].includes(k))||v.version!=='workspace-cover-source/v1'||typeof v.kind!=='string'||!['material','artifact'].includes(v.kind)||typeof v.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id)||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))throw Error('封面来源协议或身份无效。');
 return{version:'workspace-cover-source/v1',kind:v.kind as WorkspaceCoverSource['kind'],id:v.id,sha256:v.sha256};
}
