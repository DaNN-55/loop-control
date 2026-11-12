-- Deployment mapping only. Frozen blueprint policies and artifact paths remain
-- byte-identical; local file serving never reads the source filesystem root.
ALTER TABLE local_identity.import_record ADD COLUMN source_media_root text;
