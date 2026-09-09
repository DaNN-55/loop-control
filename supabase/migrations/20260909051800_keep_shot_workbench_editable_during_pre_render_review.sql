do $$
declare
  signature regprocedure;
  definition text;
  patched text;
  old_stage_list constant text := '(''storyboard_approved'', ''render_ready'', ''qc_review'')';
  new_stage_list constant text := '(''storyboard_approved'', ''production_ready'', ''render_ready'', ''qc_review'')';
begin
  foreach signature in array array[
    'public.save_shot_preparation_draft(uuid, uuid, text, text, text, boolean, text, text, numeric)'::regprocedure,
    'public.save_shot_workbench_draft(uuid, uuid, text, uuid, jsonb, text, text, boolean, text, text, numeric)'::regprocedure,
    'public.save_shot_tts_override(uuid, uuid, text, text, numeric)'::regprocedure,
    'public.save_episode_tts_settings(uuid, text, text, numeric)'::regprocedure,
    'public.generate_shot_tts(uuid, uuid, text, boolean)'::regprocedure,
    'public.generate_confirmed_shot_tts_batch(uuid, uuid)'::regprocedure,
    'public.generate_shot_review_video(uuid, uuid, jsonb, boolean, text)'::regprocedure,
    'public.protect_frozen_shot_preparation_inputs()'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    if position(new_stage_list in definition) > 0 and position(old_stage_list in definition) = 0 then
      continue;
    end if;
    if position(old_stage_list in definition) = 0 or position(new_stage_list in definition) > 0 then
      raise exception '% pre-render editable-stage patch has unknown or partial state', signature;
    end if;
    patched := replace(definition, old_stage_list, new_stage_list);
    if position(new_stage_list in patched) = 0 or position(old_stage_list in patched) > 0 then
      raise exception '% pre-render editable-stage patch produced an invalid state', signature;
    end if;
    execute patched;
  end loop;
end;
$$;
