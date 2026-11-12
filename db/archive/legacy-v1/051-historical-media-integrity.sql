-- Retain explicit, approved source integrity failures without changing artifacts.
-- Application and Worker file reads continue to require each artifact fingerprint.
ALTER TABLE local_identity.import_record ADD COLUMN historical_media_integrity jsonb;
ALTER TABLE local_identity.import_record ADD CONSTRAINT historical_media_integrity_shape
 CHECK(historical_media_integrity IS NULL OR
  (jsonb_typeof(historical_media_integrity)='object'
   AND historical_media_integrity ?& ARRAY['version','approvalSha256','exceptions']
   AND historical_media_integrity->'version'='1'::jsonb
   AND historical_media_integrity->>'approvalSha256' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(historical_media_integrity->'exceptions')='array'));
