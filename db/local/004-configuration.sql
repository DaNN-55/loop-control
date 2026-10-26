CREATE TABLE local_identity.command_receipts(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE RESTRICT,
 idempotency_key uuid NOT NULL,
 payload_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,idempotency_key)
);
REVOKE ALL ON local_identity.command_receipts FROM PUBLIC;
GRANT SELECT,INSERT ON local_identity.command_receipts TO loop_app;
GRANT SELECT ON public.prompt_versions TO loop_owner;
GRANT EXECUTE ON FUNCTION public.create_account(text,text,text,jsonb),public.update_current_blueprint(uuid,jsonb),public.create_blueprint_version(uuid,jsonb),public.activate_blueprint_version(uuid,uuid),public.set_blueprint_archived(uuid,uuid,boolean),public.rename_account(uuid,text),public.set_account_archived(uuid,boolean),public.delete_account(uuid,text),public.create_series(uuid,text,jsonb),public.create_series_version(uuid,jsonb),public.create_prompt_version(uuid,text,text,text,text) TO loop_owner;
