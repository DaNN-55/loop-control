-- ADR-0064: retire unreachable revision dispatch and obsolete new-account templates.
-- Preserve every existing row and the historical storyboard completion validator.
DROP TRIGGER create_script_revision_task_after_changes_requested ON public.approvals;
DROP FUNCTION public.create_script_revision_task_after_changes_requested();
DROP TRIGGER create_visual_revision_task_after_changes_requested ON public.approvals;
DROP FUNCTION public.create_visual_revision_task_after_changes_requested();
DROP TRIGGER accounts_seed_prompt_versions ON public.accounts;
DROP FUNCTION public.seed_account_prompt_versions();
