-- SQL110 is the only position authority. Only future task construction changes;
-- completed audio registration continues to use the exact frozen output artifact.
DO $adapt$
DECLARE d text; changed text; prefix text:='(SELECT directory_relative_path FROM local_identity.episode_storage_location(prep.episode_id))';
BEGIN
 d:=pg_get_functiondef('local_identity.queue_workspace_audio(uuid,boolean,jsonb)'::regprocedure);
 changed:=replace(d,
  'coalesce(p_source->>''relativePath'','''') NOT LIKE ''episodes/''||prep.episode_id::text||''/%''',
  '(left(coalesce(p_source->>''relativePath'',''''),length('||prefix||')+1) IS DISTINCT FROM '||prefix||'||''/'' AND left(coalesce(p_source->>''relativePath'',''''),length(''episodes/''||prep.episode_id::text)+1) IS DISTINCT FROM ''episodes/''||prep.episode_id::text||''/'')');
 IF changed=d THEN RAISE EXCEPTION 'Workspace source path guard contract changed';END IF;
 d:=changed;changed:=replace(d,'format(''episodes/%s/workspace-audio/%s/%s.mp3'',prep.episode_id,','format(''%s/workspace-audio/%s/%s.mp3'','||prefix||',');
 IF changed=d THEN RAISE EXCEPTION 'Workspace audio output contract changed';END IF;EXECUTE changed;

 d:=pg_get_functiondef('local_identity.queue_selected_workspace_narration(uuid,text,jsonb,boolean)'::regprocedure);
 changed:=replace(d,'format(''episodes/%s/audio/shot-narration-%s-%s.mp3'',e.id,','format(''%s/audio/shot-narration-%s-%s.mp3'',(SELECT directory_relative_path FROM local_identity.episode_storage_location(e.id)),');
 IF changed=d THEN RAISE EXCEPTION 'Selected narration output contract changed';END IF;EXECUTE changed;

 d:=pg_get_functiondef('local_identity.scope_input_post_task(uuid)'::regprocedure);
 changed:=replace(d,'format(''episodes/%s/post-production/%s'',t.episode_id,t.id)','format(''%s/post-production/%s'',(SELECT directory_relative_path FROM local_identity.episode_storage_location(t.episode_id)),t.id)');
 IF changed=d THEN RAISE EXCEPTION 'Post-production output contract changed';END IF;EXECUTE changed;
END $adapt$;
