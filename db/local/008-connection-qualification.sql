-- A transient probe result is not the connection's lasting qualification.
CREATE TABLE local_identity.connection_qualifications(
 version_id uuid PRIMARY KEY REFERENCES public.external_connection_versions(id),
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 qualified boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON local_identity.connection_qualifications FROM PUBLIC;
GRANT SELECT ON local_identity.connection_qualifications TO loop_app;

CREATE OR REPLACE FUNCTION public.connection_version_is_verified(p_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.external_connection_versions v
 JOIN public.external_connections c ON c.id=v.connection_id
 JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=c.created_by AND b.store_mode='keychain'
 JOIN local_identity.connection_qualifications q ON q.version_id=v.id AND q.owner_id=c.created_by AND q.qualified
 WHERE v.id=p_version_id AND c.created_by=local_identity.owner_id() AND c.current_version_id=v.id AND v.revoked_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.connection_version_is_verified(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.connection_version_is_verified(uuid) TO loop_owner;

ALTER FUNCTION local_identity.apply_connection_intent(uuid) RENAME TO apply_connection_intent_v1;
REVOKE ALL ON FUNCTION local_identity.apply_connection_intent_v1(uuid) FROM loop_owner;
CREATE FUNCTION local_identity.apply_connection_intent(p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i local_identity.connection_intents; result jsonb;
BEGIN
 SELECT * INTO i FROM local_identity.connection_intents WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intent not found' USING ERRCODE='P0002'; END IF;
 result:=local_identity.apply_connection_intent_v1(p_key);
 IF i.applied_at IS NULL AND i.metadata->>'command'='rebind' THEN
  INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES(i.version_id,i.owner_id,false)
  ON CONFLICT(version_id) DO UPDATE SET qualified=false,updated_at=now();
 END IF;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION local_identity.apply_connection_intent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.apply_connection_intent(uuid) TO loop_owner;

CREATE OR REPLACE FUNCTION local_identity.record_connection_probe(p_id uuid,p_mode text,p_outcome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.external_connection_versions; c public.external_connections; saved_status text; detail text; qualified boolean;
BEGIN
 IF p_mode NOT IN ('live','simulated') OR p_outcome NOT IN ('verified','invalid','retryable') THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023'; END IF;
 SELECT version.* INTO v FROM public.external_connection_versions version JOIN public.external_connections connection ON connection.id=version.connection_id
 WHERE version.id=p_id AND connection.created_by=local_identity.owner_id() AND version.revoked_at IS NULL FOR UPDATE OF version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Version not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO c FROM public.external_connections WHERE id=v.connection_id FOR UPDATE;
 IF c.current_version_id<>v.id THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.connection_bindings WHERE version_id=v.id AND owner_id=c.created_by AND (p_mode='simulated' OR store_mode='keychain')) THEN RAISE EXCEPTION 'Binding required' USING ERRCODE='22023'; END IF;
 saved_status:=CASE WHEN p_mode='simulated' THEN 'retryable' ELSE p_outcome END;
 detail:=CASE WHEN p_mode='simulated' THEN '仅模拟验证；真实Keychain及在线验证尚未完成。' WHEN p_outcome='verified' THEN '连接验证通过。' WHEN p_outcome='invalid' THEN '连接认证失败。' ELSE '本次验证暂不可用；既有验证资格未因此撤销。' END;
 INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES(v.id,c.created_by,p_mode,p_outcome);
 INSERT INTO public.external_connection_verifications(connection_id,connection_version_id,status,detail) VALUES(c.id,v.id,saved_status,detail);
 IF p_mode='live' THEN
  INSERT INTO local_identity.connection_qualifications(version_id,owner_id,qualified) VALUES(v.id,c.created_by,p_outcome='verified')
  ON CONFLICT(version_id) DO UPDATE SET qualified=CASE WHEN p_outcome='retryable' THEN local_identity.connection_qualifications.qualified ELSE p_outcome='verified' END,updated_at=now();
 END IF;
 qualified:=public.connection_version_is_verified(v.id);
 UPDATE public.external_connections SET status=CASE WHEN qualified THEN 'verified' ELSE saved_status END,last_verification_detail=detail,last_verified_at=now() WHERE id=c.id;
END;
$$;
