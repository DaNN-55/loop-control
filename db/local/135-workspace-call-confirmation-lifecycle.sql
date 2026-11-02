-- Confirmation records belong to the same guarded production-order lifecycle.
-- Deleting a workspace/order must also remove its expired and consumed records.
ALTER TABLE local_identity.workspace_call_confirmations
 DROP CONSTRAINT workspace_call_confirmations_workspace_id_fkey,
 DROP CONSTRAINT workspace_call_confirmations_episode_id_fkey,
 ADD CONSTRAINT workspace_call_confirmations_workspace_id_fkey FOREIGN KEY(workspace_id) REFERENCES local_identity.production_workspaces(id) ON DELETE CASCADE,
 ADD CONSTRAINT workspace_call_confirmations_episode_id_fkey FOREIGN KEY(episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE;
CREATE INDEX workspace_call_confirmations_workspace_idx ON local_identity.workspace_call_confirmations(workspace_id);
CREATE INDEX workspace_call_confirmations_episode_idx ON local_identity.workspace_call_confirmations(episode_id);
