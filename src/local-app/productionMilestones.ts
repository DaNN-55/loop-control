import type {PoolClient} from 'pg';

/** Only actual SDK opens and changed native saves call this; preparation edits are separate. */
export async function recordWorkspaceEditingMilestone(c:PoolClient,workspaceId:string,milestone:'editing_opened'|'native_edit_saved'){
 if((await c.query("SELECT to_regprocedure('local_identity.record_workspace_editing_milestone(uuid,text)') IS NOT NULL present")).rows[0].present)await c.query('SELECT local_identity.record_workspace_editing_milestone($1,$2)',[workspaceId,milestone]);
}
