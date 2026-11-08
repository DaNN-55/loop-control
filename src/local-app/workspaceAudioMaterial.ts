// A shelf import has no assigned role until the user selects it in a workspace.
export const unassignedWorkspaceAudioPurpose='general_reference';

export type WorkspaceAudioMaterialPurpose='narration'|'background_music'|'sound_effect';

export function canUseWorkspaceAudioMaterial(purpose:string|null|undefined,target:WorkspaceAudioMaterialPurpose){
 return purpose===unassignedWorkspaceAudioPurpose||purpose===target;
}
