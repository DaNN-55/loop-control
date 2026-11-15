-- ADR-0054: remove retired shot revision/review writers and their two dedicated
-- producers. Shared approval, evidence, lineage and Worker guards stay intact.
-- Explicit signatures and RESTRICT make unexpected dependencies abort the whole
-- migration. Historical rows, frozen baseline and archived SQL are unchanged.
DROP TRIGGER create_storyboard_revision_task_after_changes_requested ON public.approvals;
DROP TRIGGER create_storyboard_revision_review_package_after_task ON public.tasks;
DROP FUNCTION local_identity.request_shot_revision(uuid,uuid,jsonb,text);
DROP FUNCTION public.request_shot_structure_revision(uuid,uuid,jsonb,text);
DROP FUNCTION public.canonical_storyboard_structure_revision_operation(jsonb);
DROP FUNCTION public.create_storyboard_annotation(uuid,text,text);
DROP FUNCTION public.review_pre_render_member(uuid,text,text,text);
DROP FUNCTION public.create_storyboard_revision_task_after_changes_requested();
DROP FUNCTION public.create_storyboard_revision_review_package();
