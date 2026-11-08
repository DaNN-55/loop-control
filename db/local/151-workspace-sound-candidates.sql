-- Add a frozen result index to new sound-candidate requests. Existing tasks and
-- preparations keep their original inputs, authorization and publication path.
DO $sound_candidates$
DECLARE original text;changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_workspace_audio(uuid,boolean,jsonb)'::regprocedure);
 changed:=replace(original,
  'frozen:=frozen||jsonb_build_object(''configuration_hash''',
  'IF prep.kind=''sfx'' AND prep.request_snapshot ? ''candidateIndex'' THEN
    IF jsonb_typeof(prep.request_snapshot->''candidateIndex'') IS DISTINCT FROM ''number'' OR (prep.request_snapshot->>''candidateIndex'')::integer NOT BETWEEN 0 AND 2 THEN RAISE EXCEPTION ''Invalid sound candidate index'' USING ERRCODE=''22023''; END IF;
    frozen:=jsonb_set(frozen,''{media,soundtrack,candidate_index}'',prep.request_snapshot->''candidateIndex'');
   END IF;
   frozen:=frozen||jsonb_build_object(''configuration_hash''');
 IF changed=original THEN RAISE EXCEPTION 'Workspace audio queue protocol changed';END IF;
 EXECUTE changed;
END $sound_candidates$;
