ALTER TABLE local_identity.connection_model_settings
 ADD COLUMN discovered_models text[] NOT NULL DEFAULT '{}' CHECK(cardinality(discovered_models)<=256),
 ADD COLUMN discovery_version_id uuid REFERENCES public.external_connection_versions(id),
 ADD COLUMN discovered_at timestamptz;
