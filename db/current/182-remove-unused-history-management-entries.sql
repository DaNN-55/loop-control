-- ADR-0062: retired history management has no current or saved-runtime callers.
-- Preserve all history data, receipt recovery, shared guards and exact deletion authority.
DROP FUNCTION local_identity.preview_history_cleanup(text,text);
DROP FUNCTION local_identity.preview_history_episode(text,text);
DROP FUNCTION local_identity.delete_history_episode(text,text,text,text[]);
