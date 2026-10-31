-- Settled generation reservations reference managed materials. Remove only this
-- Episode's reservations before the existing Episode cascade deletes materials;
-- keep Owner/archive/task locks and filesystem rollback in the guarded protocol.
DO $generation_delete$
DECLARE original text;patched text;marker text:='  delete from public.shot_preparation_drafts where episode_id = p_episode_id;';
BEGIN
 original:=pg_get_functiondef('public.delete_episode(uuid,uuid)'::regprocedure);
 IF strpos(original,marker)=0 THEN RAISE EXCEPTION 'Guarded Episode deletion protocol changed'; END IF;
 patched:=replace(original,marker,$cleanup$
DELETE FROM public.paid_generation_reservations
 WHERE task_id IN (SELECT id FROM public.tasks WHERE episode_id=p_episode_id);
$cleanup$||marker);
 EXECUTE patched;
END $generation_delete$;

-- An unchanged speech input already has its completed candidate. Editing only a
-- visual range must not create another paid speech task on a repeated command.
DO $speech_dedup$
DECLARE original text;patched text;marker text:='t.status IN (''ready'',''running'') OR t.status IN (''failed'',''blocked'') AND NOT p_retry';
BEGIN
 original:=pg_get_functiondef('local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)'::regprocedure);
 IF strpos(original,marker)=0 THEN RAISE EXCEPTION 'Selected speech deduplication protocol changed'; END IF;
 patched:=replace(original,marker,'t.status IN (''ready'',''running'',''completed'') OR t.status IN (''failed'',''blocked'') AND NOT p_retry');
 EXECUTE patched;
END $speech_dedup$;
