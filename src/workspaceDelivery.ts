import type {ArtifactManifest} from './worker/contracts.js';
export const workspaceDeliveryFields:Record<string,string[]>={prepareWorkspaceDelivery:['episodeId','workspaceId','expectedRevision','exportId','expectedExportSha256','expectedContentSha256','title','description','tags','coverBase64'],retryWorkspaceDelivery:['episodeId','workspaceId','expectedRevision','deliveryId']};
export interface WorkspaceDelivery {id:string;exportId:string;taskId:string;status:string;error:string|null;verified:boolean;artifacts:ArtifactManifest[];createdAt:string}
