-- Episode defaults only prefill future music requests; tasks and native tracks own their frozen input.
ALTER TABLE local_identity.production_workspaces ADD COLUMN music_defaults jsonb
 CHECK (music_defaults IS NULL OR (jsonb_typeof(music_defaults)='object' AND jsonb_typeof(music_defaults->'selection')='object'));
