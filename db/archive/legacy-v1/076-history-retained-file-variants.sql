-- Equal file bytes can have distinct historical classification and safe metadata.
-- Preserve every variant without retaining disposable source identities or renaming paths.
ALTER TABLE local_identity.history_retained_files
 ADD COLUMN retention_variant text GENERATED ALWAYS AS (
  md5(bytes::text||':'||length(kind)::text||':'||kind||':'||metadata::text)
 ) STORED;
ALTER TABLE local_identity.history_retained_files DROP CONSTRAINT history_retained_files_pkey;
ALTER TABLE local_identity.history_retained_files
 ADD PRIMARY KEY(owner_id,logical_path,sha256,retention_variant);
