-- Per-request Owner confirmation. Historical authorizations are read-only compatibility evidence.
CREATE TABLE local_identity.workspace_call_confirmations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,
 workspace_id uuid NOT NULL REFERENCES local_identity.production_workspaces(id),episode_id uuid NOT NULL REFERENCES public.episodes(id),
 script_revision_id uuid NOT NULL,project_sha256 text NOT NULL,workspace_revision bigint NOT NULL,
 command text NOT NULL CHECK(command IN ('requestWorkspaceImageCandidates','requestWorkspaceVisualCandidate','generateWorkspaceImage','generateWorkspaceNarration','prepareWorkspaceAudio')),
 payload jsonb NOT NULL,context_hash text NOT NULL,authorization_hash text NOT NULL UNIQUE,
 summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 consumed_at timestamptz,consumed_transaction bigint
);
ALTER TABLE local_identity.workspace_call_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_call_owner ON local_identity.workspace_call_confirmations TO loop_app
 USING(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id AND w.episode_id=workspace_call_confirmations.episode_id))
 WITH CHECK(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM local_identity.production_workspaces w WHERE w.id=workspace_id AND w.episode_id=workspace_call_confirmations.episode_id));
GRANT SELECT,INSERT,UPDATE ON local_identity.workspace_call_confirmations TO loop_app;

-- Keep the existing immutable request / Worker protocol; never write a synthetic
-- enabled script_productions row or awaken legacy automatic production.
CREATE VIEW local_identity.workspace_production_authorizations AS
 SELECT p.* FROM local_identity.script_productions p
 UNION ALL
 SELECT (jsonb_populate_record(NULL::local_identity.script_productions,jsonb_build_object(
  'episode_id',c.episode_id,'owner_id',c.owner_id,'script_revision_id',c.script_revision_id,
  'script_sha256',m.sha256,'enabled',true,'authorization_hash',c.authorization_hash,'authorized_at',c.consumed_at,
  'plan',jsonb_build_object('version','workspace-call/v1'),'progress','{}'::jsonb,'last_status','逐次调用已确认',
  'created_at',c.created_at,'updated_at',c.consumed_at))).*
 FROM local_identity.workspace_call_confirmations c JOIN public.production_material_revisions m ON m.id=c.script_revision_id
 WHERE c.consumed_at IS NOT NULL;
REVOKE ALL ON local_identity.workspace_production_authorizations FROM PUBLIC,loop_app,loop_owner,loop_worker,loop_anonymous;
CREATE FUNCTION local_identity.current_workspace_call_hash(p_workspace uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.authorization_hash FROM local_identity.workspace_call_confirmations c
 WHERE c.id::text=current_setting('loop.workspace_call_confirmation',true) AND c.workspace_id=p_workspace
 AND c.owner_id=local_identity.owner_id() AND c.consumed_at IS NOT NULL AND c.consumed_transaction=txid_current()
$$;
REVOKE ALL ON FUNCTION local_identity.current_workspace_call_hash(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.current_workspace_call_hash(uuid) TO loop_owner;

-- Change only the source of authorization, preserving budgets, leases, inputs,
-- saved Provider ID polling, and unknown-submission guards in the original bodies.
DO $calls$
DECLARE sig text;original text;changed text;
BEGIN
 FOREACH sig IN ARRAY ARRAY[
 'local_identity.queue_workspace_images(uuid)',
 'local_identity.reserve_workspace_images(uuid,integer,uuid)',
 'local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)',
 'local_identity.request_workspace_wan_visual(uuid,uuid,text,uuid,text,integer,uuid)',
 'local_identity.reserve_workspace_visual_generation(uuid,integer,uuid)',
 'local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)',
 'local_identity.reserve_workspace_narration_submission(uuid,integer,uuid)',
 'local_identity.reserve_workspace_narration_submission_legacy(uuid,integer,uuid)',
 'local_identity.queue_workspace_audio(uuid,boolean,jsonb)',
 'local_identity.workspace_audio_task_current(uuid,integer,uuid)'
 ] LOOP
  original:=pg_get_functiondef(sig::regprocedure);
  changed:=replace(original,'FROM local_identity.script_productions','FROM local_identity.workspace_production_authorizations');
  changed:=replace(changed,'from local_identity.script_productions','from local_identity.workspace_production_authorizations');
  changed:=replace(changed,'JOIN local_identity.script_productions','JOIN local_identity.workspace_production_authorizations');
  changed:=replace(changed,'join local_identity.script_productions','join local_identity.workspace_production_authorizations');
  IF changed=original THEN RAISE EXCEPTION 'Workspace call authorization protocol changed: %',sig;END IF;
  IF sig='local_identity.queue_workspace_images(uuid)' THEN
   changed:=replace(changed,'AND enabled AND authorized_at IS NOT NULL;','AND enabled AND authorized_at IS NOT NULL AND authorization_hash=local_identity.current_workspace_call_hash(w.id);');
  ELSIF sig='local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)' THEN
   changed:=replace(changed,'AND script_revision_id=w.script_revision_id;','AND script_revision_id=w.script_revision_id AND authorization_hash=local_identity.current_workspace_call_hash(w.id);');
  ELSIF sig='local_identity.queue_workspace_audio(uuid,boolean,jsonb)' THEN
   changed:=replace(changed,'AND enabled AND authorized_at IS NOT NULL;','AND enabled AND authorized_at IS NOT NULL AND authorization_hash=local_identity.current_workspace_call_hash(workspace.id);');
  END IF;
  EXECUTE changed;
 END LOOP;
END $calls$;

-- A saved hash from another call may validate an existing Worker task, but cannot
-- authorize a new video task outside this confirmation transaction.
DO $video_call$
DECLARE original text;changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_workspace_visual(uuid)'::regprocedure);
 changed:=replace(original,'IF v.task_id IS NOT NULL THEN RETURN v.task_id;END IF;',
  'IF v.task_id IS NOT NULL THEN RETURN v.task_id;END IF;
 IF v.request_snapshot->>''authorizationHash'' IS DISTINCT FROM local_identity.current_workspace_call_hash(v.workspace_id) OR local_identity.current_workspace_call_hash(v.workspace_id) IS NULL THEN RAISE EXCEPTION ''Current call confirmation required'' USING ERRCODE=''42501'';END IF;');
 IF changed=original THEN RAISE EXCEPTION 'Workspace video queue protocol changed';END IF;
 EXECUTE changed;
END $video_call$;
