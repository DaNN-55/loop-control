-- ADR-0056: no current, saved-runtime or recovery consumers of these retired RPCs.
-- Keep local intents, Keychain bindings, frozen version references and historical SQL.
-- Default RESTRICT rejects unexpected dependencies; never cascade or grant access.
DROP FUNCTION public.create_external_connection(text,text,text,text);
DROP FUNCTION public.rotate_external_connection(uuid,text,text,text);
DROP FUNCTION public.delete_external_connection_version(uuid);
DROP FUNCTION public.resolve_external_connection_secret(uuid);
DROP FUNCTION public.resolve_external_connection_secret(uuid,uuid);
