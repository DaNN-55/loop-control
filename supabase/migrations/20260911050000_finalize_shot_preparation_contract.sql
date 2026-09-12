alter table public.shot_preparation_drafts
  add column preparation_contract_status text not null default 'needs_upgrade'
    check (preparation_contract_status in ('current', 'needs_upgrade'));

-- Every row that predates this migration keeps its media, tasks, previews,
-- projects, review packages, audit history, and legacy confirmation facts. The
-- compatibility defaults added by earlier migrations are readable, but are not
-- evidence that an Owner reviewed the complete v1 contract.
alter table public.shot_preparation_drafts
  alter column preparation_contract_status set default 'current';

comment on column public.shot_preparation_drafts.preparation_contract_status is
  'current means the Owner saved the complete v1 shot contract after the cutover; needs_upgrade keeps pre-cutover rows readable without treating compatibility defaults as new acceptance evidence.';

do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef('public.has_current_shot_preparation_snapshot(uuid,uuid)'::regprocedure);
  patched := replace(definition,
    'draft.preparation_contract is not null',
    'draft.preparation_contract_status = ''current'' and draft.preparation_contract is not null');
  if patched = definition then raise exception 'has_current_shot_preparation_snapshot cutover patch target is unknown'; end if;
  execute patched;

  definition := pg_get_functiondef('public.generate_shot_sync_preview(uuid,uuid,text)'::regprocedure);
  patched := replace(definition,
    'if not found or draft.preparation_contract is null',
    'if not found or draft.preparation_contract_status <> ''current'' or draft.preparation_contract is null');
  if patched = definition then raise exception 'generate_shot_sync_preview cutover patch target is unknown'; end if;
  execute patched;

  definition := pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure);
  patched := replace(definition,
    'if draft.preparation_contract is null',
    'if draft.preparation_contract_status <> ''current'' or draft.preparation_contract is null');
  if patched = definition then raise exception 'confirm_shot_sync_preview cutover patch target is unknown'; end if;
  execute patched;

  definition := pg_get_functiondef('public.save_shot_transition_mode(uuid,uuid,text,text)'::regprocedure);
  patched := replace(definition,
    'set transition_mode = p_transition_mode,',
    'set transition_mode = p_transition_mode, preparation_contract_status = ''current'',');
  if patched = definition then raise exception 'save_shot_transition_mode cutover patch target is unknown'; end if;
  execute patched;
end;
$$;
