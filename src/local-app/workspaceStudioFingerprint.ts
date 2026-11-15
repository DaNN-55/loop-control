import {createHash} from 'node:crypto';

/** Saved legacy hosts keep their original identity; current hosts freeze the independent basis. */
export function workspaceStudioFingerprint(row:{id:string;script_revision_id:string;preparation_revision_id:string;storyboard_package_id:string|null}){
 const identity=row.storyboard_package_id?{id:row.id,scriptRevisionId:row.script_revision_id,storyboardPackageId:row.storyboard_package_id}:
  {version:'production-workspace/v2',workspaceId:row.id,scriptRevisionId:row.script_revision_id,preparationRevisionId:row.preparation_revision_id};
 return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
