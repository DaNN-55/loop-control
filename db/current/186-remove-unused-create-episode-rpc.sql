-- ADR-0067: current creation uses the owned directory-intent protocol.
-- No saved runtime bundle or history restore requires this obsolete public RPC.
-- RESTRICT keeps unexpected dependencies visible; no business rows or ACLs are rewritten.
DROP FUNCTION public.create_episode(uuid,uuid,uuid,text,boolean);
