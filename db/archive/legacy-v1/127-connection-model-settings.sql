CREATE TABLE local_identity.connection_model_settings (
  connection_id uuid PRIMARY KEY REFERENCES public.external_connections(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
  enabled_models text[] NOT NULL CHECK (cardinality(enabled_models) <= 256),
  revision uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.connection_model_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY connection_model_settings_owner ON local_identity.connection_model_settings
  TO loop_owner USING (owner_id = local_identity.owner_id() AND EXISTS (
    SELECT 1 FROM public.external_connections c WHERE c.id=connection_id AND c.created_by=owner_id
  )) WITH CHECK (owner_id = local_identity.owner_id() AND EXISTS (
    SELECT 1 FROM public.external_connections c WHERE c.id=connection_id AND c.created_by=owner_id
  ));
GRANT SELECT, INSERT, UPDATE ON local_identity.connection_model_settings TO loop_owner;
