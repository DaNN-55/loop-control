-- Return only a reference decision, including accounts hidden by the caller's RLS.
-- This does not modify business data, history, or filesystem state.
CREATE OR REPLACE FUNCTION local_identity.account_directory_has_references(p_paths text[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF session_user<>'loop_app' OR local_identity.owner_id() IS NULL THEN
  RAISE EXCEPTION 'Owner session required' USING ERRCODE='42501';
 END IF;
 IF cardinality(p_paths) IS NULL OR cardinality(p_paths)=0 OR cardinality(p_paths)>256
    OR EXISTS(SELECT 1 FROM unnest(p_paths) p WHERE p IS NULL OR left(p,1)<>'/' OR p='/') THEN
  RAISE EXCEPTION 'Invalid account directory paths' USING ERRCODE='22023';
 END IF;
 RETURN EXISTS(
  SELECT 1 FROM public.account_blueprint_versions b CROSS JOIN unnest(p_paths) p
  WHERE jsonb_typeof(b.policy->'asset_root')='string'
   AND rtrim(b.policy->>'asset_root','/')<>''
   AND (rtrim(b.policy->>'asset_root','/')=p
     OR left(rtrim(b.policy->>'asset_root','/'),length(p)+1)=p||'/'
     OR left(p,length(rtrim(b.policy->>'asset_root','/'))+1)=rtrim(b.policy->>'asset_root','/')||'/')
 );
END;
$$;
REVOKE ALL ON FUNCTION local_identity.account_directory_has_references(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.account_directory_has_references(text[]) TO loop_app;
