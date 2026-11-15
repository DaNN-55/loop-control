/** Read-only source identities; importing still rechecks every original boundary. */
export type WorkspaceSourceReference=
 |{kind:'saved-native';reviewPackageId:string;savedProjectSha256:string}
 |{kind:'rendered-project';reviewPackageId:string;artifactId:string;expectedSourceSha256:string}
 |{kind:'saved-plan';expectedPlanSha256:string}
 |{kind:'shot-workbench';reviewPackageId:string;workbenchSha256:string;mode:'confirmed'|'inputs'};
export interface WorkspaceSourceOption {
 id:string;label:string;summary:string;source:WorkspaceSourceReference|null;unavailableReason?:string;
}
export interface WorkspaceSourceOptions {
 version:'workspace-source-options/v1';scriptRevisionId:string|null;options:WorkspaceSourceOption[];
}
