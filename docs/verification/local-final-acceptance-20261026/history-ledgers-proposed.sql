-- Preserve source historical budget/reservation rows without enabling generators.
CREATE TABLE public.generation_account_budgets (
 account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
 trial_video_limit_cents integer NOT NULL CHECK(trial_video_limit_cents>0),
 total_limit_cents integer NOT NULL CHECK(total_limit_cents>=trial_video_limit_cents),
 full_generation_enabled boolean NOT NULL DEFAULT false,
 approved_by uuid NOT NULL REFERENCES local_identity.owners(id),
 approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.paid_generation_reservations (
 task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('video','narration')),
 reserved_cents integer NOT NULL CHECK(reserved_cents>0),
 provider_task_id text,
 request_state text NOT NULL DEFAULT 'submitting' CHECK(request_state IN ('submitting','submitted','succeeded')),
 material_revision_id uuid REFERENCES public.production_material_revisions(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paid_generation_reservations_account_idx ON public.paid_generation_reservations(account_id);
ALTER TABLE public.generation_account_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paid_generation_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.generation_account_budgets,public.paid_generation_reservations FROM PUBLIC,loop_owner,loop_worker,loop_anonymous;
GRANT SELECT ON public.generation_account_budgets,public.paid_generation_reservations TO loop_owner;
CREATE POLICY historical_budget_owner_read ON public.generation_account_budgets FOR SELECT TO loop_owner USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=generation_account_budgets.account_id AND m.user_id=(SELECT local_identity.owner_id()) AND m.role='owner'));
CREATE POLICY historical_reservation_owner_read ON public.paid_generation_reservations FOR SELECT TO loop_owner USING(EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=paid_generation_reservations.account_id AND m.user_id=(SELECT local_identity.owner_id()) AND m.role='owner'));
