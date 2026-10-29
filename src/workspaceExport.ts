export interface WorkspaceExportCheck {name:string;passed:boolean;detail:string;[key:string]:unknown}
export interface WorkspaceExportArtifact {relativePath:string;sha256:string;fileSize:number}
export interface WorkspaceExport {id:string;projectContentVersion:number;contentSha256:string;project:WorkspaceExportArtifact;status:'failed'|'ready';artifact:WorkspaceExportArtifact|null;checks:WorkspaceExportCheck[];createdAt:string;confirmedAt:string|null;confirmed:boolean;current:boolean}
export interface WorkspaceExportIssue {id:string;exportId:string|null;reason:string;resolved:boolean}
export const workspaceExportFields:Record<string,string[]>={
 exportWorkspace:['episodeId','workspaceId','expectedRevision'],
 confirmWorkspaceExport:['episodeId','workspaceId','expectedRevision','exportId','expectedExportSha256','expectedContentSha256'],
 recordWorkspaceExportIssue:['episodeId','workspaceId','expectedRevision','exportId','reason'],
 resolveWorkspaceExportIssue:['episodeId','workspaceId','expectedRevision','issueId'],
};
