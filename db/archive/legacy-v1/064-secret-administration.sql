-- Metadata, audit and rate windows only; never store secret values or passwords.
CREATE TABLE local_identity.secret_access_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id uuid, at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reference text CHECK(reference IS NULL OR reference ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' OR reference='system:unlock-anchor'),
 operation text NOT NULL CHECK(operation IN ('list','detail','view','copy')),
 outcome text NOT NULL CHECK(outcome IN ('success','denied')),
 reason text NOT NULL CHECK(reason ~ '^[a-z_]{1,48}$')
);
CREATE INDEX secret_access_audit_actor_at ON local_identity.secret_access_audit(actor_id,at DESC);
CREATE TABLE local_identity.secret_access_windows(
 owner_id uuid NOT NULL, scope text NOT NULL CHECK(scope IN ('metadata','plaintext')),
 started_at timestamptz NOT NULL, requests integer NOT NULL CHECK(requests>0),
 PRIMARY KEY(owner_id,scope)
);
REVOKE ALL ON local_identity.secret_access_audit,local_identity.secret_access_windows FROM PUBLIC,loop_owner,loop_worker;
GRANT INSERT ON local_identity.secret_access_audit TO loop_app;
GRANT USAGE ON SEQUENCE local_identity.secret_access_audit_id_seq TO loop_app;
GRANT SELECT,INSERT,UPDATE ON local_identity.secret_access_windows TO loop_app;

CREATE FUNCTION local_identity.secret_reference_inventory(p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Verified application session required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
  'connections',coalesce((SELECT jsonb_agg(jsonb_build_object('reference',b.secret_ref,'connectionId',c.id,'name',c.name,'provider',v.provider,'version',v.version,'current',c.current_version_id=v.id,'revoked',v.revoked_at IS NOT NULL)) FROM local_identity.connection_bindings b JOIN public.external_connection_versions v ON v.id=b.version_id JOIN public.external_connections c ON c.id=v.connection_id WHERE b.store_mode='keychain'),'[]'),
  'intents',coalesce((SELECT jsonb_agg(jsonb_build_object('reference',secret_ref,'name',metadata->>'name','operation',metadata->>'command')) FROM local_identity.connection_intents WHERE store_mode='keychain' AND applied_at IS NULL),'[]'),
  'history',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(
   SELECT reference,count(*)::integer occurrences FROM(
    SELECT m[1] reference FROM local_identity.history_versions v CROSS JOIN LATERAL regexp_matches(v.payload::text,'(?:"\$keychainRef"\s*:\s*"|keychain:)([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})','g') m
    UNION ALL SELECT r->>'reference' FROM local_identity.history_file_protections p CROSS JOIN LATERAL jsonb_array_elements(p.replacements) r
    UNION ALL SELECT r->>'reference' FROM local_identity.history_files f CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.metadata->'replacements')='array' THEN f.metadata->'replacements' ELSE '[]'::jsonb END) r
   ) refs WHERE reference ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' GROUP BY reference
  ) x),'[]'),
  'files',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(
    SELECT DISTINCT ON(coalesce(p.protected_sha256,f.sha256)) coalesce(p.protected_sha256,f.sha256) sha256, coalesce(p.protected_bytes,f.bytes) bytes, f.logical_path FROM local_identity.history_files f LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256
    WHERE f.bytes>0 AND (f.logical_path ~* '\.(json|jsonl|md|txt|sql|ya?ml|toml|env|sh|py|[cm]?[jt]sx?|html|css|csv|log|ini|conf)$' OR f.kind IN ('text','source'))
    ORDER BY coalesce(p.protected_sha256,f.sha256),f.logical_path
  ) x),'[]')
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION local_identity.secret_reference_inventory(text) FROM PUBLIC,loop_owner,loop_worker;
GRANT EXECUTE ON FUNCTION local_identity.secret_reference_inventory(text) TO loop_app;
