CREATE TABLE local_identity.connection_billing_credentials (
 id uuid PRIMARY KEY,
 connection_id uuid NOT NULL REFERENCES public.external_connections(id),
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 provider text NOT NULL CHECK (provider IN ('aliyun','volcengine','openai')),
 secret_ref uuid NOT NULL UNIQUE,
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 operation_key uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','current','retired')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,operation_key)
);
CREATE UNIQUE INDEX connection_billing_current ON local_identity.connection_billing_credentials(connection_id) WHERE status='current';
ALTER TABLE local_identity.connection_billing_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY connection_billing_owner ON local_identity.connection_billing_credentials TO loop_owner
 USING(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM public.external_connections c WHERE c.id=connection_id AND c.created_by=owner_id))
 WITH CHECK(owner_id=local_identity.owner_id() AND EXISTS(SELECT 1 FROM public.external_connections c WHERE c.id=connection_id AND c.created_by=owner_id));
GRANT SELECT,INSERT,UPDATE ON local_identity.connection_billing_credentials TO loop_owner;
CREATE FUNCTION local_identity.protect_billing_credential() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at') OR NOT(OLD.status=NEW.status OR OLD.status='pending' AND NEW.status='current' OR OLD.status='current' AND NEW.status='retired') THEN
  RAISE EXCEPTION 'Billing credential records are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_credential_immutable BEFORE UPDATE ON local_identity.connection_billing_credentials FOR EACH ROW EXECUTE FUNCTION local_identity.protect_billing_credential();

CREATE OR REPLACE FUNCTION local_identity.secret_reference_inventory(p_session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF session_user<>'loop_app' OR NOT EXISTS(SELECT 1 FROM local_identity.sessions WHERE token_hash=p_session_hash AND owner_id=local_identity.owner_id() AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Verified application session required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
  'connections',coalesce((SELECT jsonb_agg(jsonb_build_object('reference',b.secret_ref,'connectionId',c.id,'name',c.name,'provider',v.provider,'version',v.version,'current',c.current_version_id=v.id,'revoked',v.revoked_at IS NOT NULL)) FROM local_identity.connection_bindings b JOIN public.external_connection_versions v ON v.id=b.version_id JOIN public.external_connections c ON c.id=v.connection_id WHERE b.store_mode='keychain'),'[]') || coalesce((SELECT jsonb_agg(jsonb_build_object('reference',b.secret_ref,'connectionId',c.id,'name',c.name||' · 账务','provider',b.provider,'version',1,'current',b.status='current','revoked',b.status='retired')) FROM local_identity.connection_billing_credentials b JOIN public.external_connections c ON c.id=b.connection_id),'[]'),
  'intents',coalesce((SELECT jsonb_agg(jsonb_build_object('reference',secret_ref,'name',metadata->>'name','operation',metadata->>'command')) FROM local_identity.connection_intents WHERE store_mode='keychain' AND applied_at IS NULL),'[]'),
  'history',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(
   SELECT reference,count(*)::integer occurrences FROM(
    SELECT m[1] reference FROM local_identity.history_versions v CROSS JOIN LATERAL regexp_matches(v.payload::text,'(?:"\$keychainRef"\s*:\s*"|keychain:)([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})','g') m
    UNION ALL SELECT r->>'reference' FROM local_identity.history_file_protections p CROSS JOIN LATERAL jsonb_array_elements(p.replacements) r
    UNION ALL SELECT r->>'reference' FROM local_identity.history_file_catalog f CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.metadata->'replacements')='array' THEN f.metadata->'replacements' ELSE '[]'::jsonb END) r
   ) refs WHERE reference ~ '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' GROUP BY reference
  ) x),'[]'),
  'files',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM(
    SELECT DISTINCT ON(coalesce(p.protected_sha256,f.sha256)) coalesce(p.protected_sha256,f.sha256) sha256, coalesce(p.protected_bytes,f.bytes) bytes, f.logical_path FROM local_identity.history_file_catalog f LEFT JOIN local_identity.history_file_protections p ON p.original_sha256=f.sha256
    WHERE f.bytes>0 AND (f.logical_path ~* '\.(json|jsonl|md|txt|sql|ya?ml|toml|env|sh|py|[cm]?[jt]sx?|html|css|csv|log|ini|conf)$' OR f.kind IN ('text','source'))
    ORDER BY coalesce(p.protected_sha256,f.sha256),f.logical_path
  ) x),'[]')
 ) INTO result;
 RETURN result;
END $$;

