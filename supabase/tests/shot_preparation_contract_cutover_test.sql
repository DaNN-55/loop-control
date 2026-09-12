begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select has_column('public', 'shot_preparation_drafts', 'preparation_contract_status', 'shot drafts expose an explicit contract cutover state');
select col_default_is('public', 'shot_preparation_drafts', 'preparation_contract_status', 'current', 'new shot drafts use only the current versioned contract path');
select col_has_check('public', 'shot_preparation_drafts', 'preparation_contract_status', 'contract cutover state is constrained');

select ok(position('preparation_contract_status = ''current''' in pg_get_functiondef('public.has_current_shot_preparation_snapshot(uuid,uuid)'::regprocedure)) > 0, 'legacy compatibility defaults do not satisfy the current snapshot gate');
select ok(position('preparation_contract_status <> ''current''' in pg_get_functiondef('public.generate_shot_sync_preview(uuid,uuid,text)'::regprocedure)) > 0, 'legacy drafts cannot write a new sync preview project');
select ok(position('preparation_contract_status <> ''current''' in pg_get_functiondef('public.confirm_shot_sync_preview(uuid,uuid,text,text,text)'::regprocedure)) > 0, 'legacy confirmation facts cannot satisfy the new Owner gate');
select ok(position('preparation_contract_status = ''current''' in pg_get_functiondef('public.save_shot_transition_mode(uuid,uuid,text,text)'::regprocedure)) > 0, 'the complete workbench save sequence explicitly upgrades the contract');

select ok(position('delete from public.shot_preparation_drafts' in lower(pg_get_functiondef('public.save_shot_transition_mode(uuid,uuid,text,text)'::regprocedure))) = 0, 'cutover does not delete legacy shot rows');
select ok(position('productionMethod' in pg_get_functiondef('public.generate_shot_sync_preview(uuid,uuid,text)'::regprocedure)) = 0, 'project generation does not parse natural-language production method hints');

select * from finish();
rollback;
