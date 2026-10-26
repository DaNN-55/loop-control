-- Secret material never enters SQL. UUIDs refer to immutable Keychain items.
CREATE TABLE local_identity.connection_bindings(
 version_id uuid PRIMARY KEY REFERENCES public.external_connection_versions(id) ON DELETE RESTRICT,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 secret_ref uuid NOT NULL UNIQUE,
 store_mode text NOT NULL CHECK(store_mode IN ('keychain','simulated')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE local_identity.connection_intents(
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 idempotency_key uuid NOT NULL,
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND NOT(metadata ? 'secret')),
 connection_id uuid NOT NULL,
 version_id uuid NOT NULL,
 secret_ref uuid NOT NULL,
 store_mode text NOT NULL CHECK(store_mode IN ('keychain','simulated')),
 applied_at timestamptz,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,idempotency_key)
);
CREATE TABLE local_identity.connection_probe_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 version_id uuid NOT NULL REFERENCES public.external_connection_versions(id),
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 mode text NOT NULL CHECK(mode IN ('live','simulated')),
 outcome text NOT NULL CHECK(outcome IN ('verified','invalid','retryable')),
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON local_identity.connection_bindings,local_identity.connection_intents,local_identity.connection_probe_evidence FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON local_identity.connection_intents TO loop_app;
GRANT SELECT ON local_identity.connection_bindings,local_identity.connection_probe_evidence TO loop_app;
GRANT SELECT ON public.external_connections,public.external_connection_verifications TO loop_owner;
GRANT EXECUTE ON FUNCTION public.official_external_connection_endpoint(text,text),public.update_external_connection(uuid,text,text),public.revoke_external_connection_version(uuid) TO loop_owner;

CREATE FUNCTION local_identity.connection_version(p_id uuid)
RETURNS TABLE(id uuid,connection_id uuid,provider text,adapter text,endpoint text,revoked_at timestamptz,is_current boolean,secret_ref uuid,store_mode text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT v.id,v.connection_id,v.provider,v.adapter,v.endpoint,v.revoked_at,c.current_version_id=v.id,b.secret_ref,b.store_mode
 FROM public.external_connection_versions v JOIN public.external_connections c ON c.id=v.connection_id
 LEFT JOIN local_identity.connection_bindings b ON b.version_id=v.id AND b.owner_id=local_identity.owner_id()
 WHERE v.id=p_id AND c.created_by=local_identity.owner_id();
$$;

CREATE FUNCTION local_identity.apply_connection_intent(p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i local_identity.connection_intents; c public.external_connections; v public.external_connection_versions; official_endpoint text; next_version int; action text;
BEGIN
 SELECT * INTO i FROM local_identity.connection_intents WHERE owner_id=local_identity.owner_id() AND idempotency_key=p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Intent not found' USING ERRCODE='P0002'; END IF;
 IF i.applied_at IS NOT NULL THEN RETURN i.result; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.account_memberships WHERE user_id=i.owner_id AND role='owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 action:=i.metadata->>'command';
 IF action IN ('create','rotate') THEN
  official_endpoint:=public.official_external_connection_endpoint(i.metadata->>'provider',i.metadata->>'adapter');
  IF official_endpoint IS NULL THEN RAISE EXCEPTION 'Provider not registered' USING ERRCODE='22023'; END IF;
  IF action='create' THEN
   INSERT INTO public.external_connections(id,provider,adapter,name,created_by,current_version_id,endpoint)
   VALUES(i.connection_id,i.metadata->>'provider',i.metadata->>'adapter',i.metadata->>'name',i.owner_id,i.version_id,official_endpoint) RETURNING * INTO c;
   next_version:=1;
  ELSE
   SELECT * INTO c FROM public.external_connections WHERE id=i.connection_id AND created_by=i.owner_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found' USING ERRCODE='P0002'; END IF;
   SELECT coalesce(max(version),0)+1 INTO next_version FROM public.external_connection_versions WHERE connection_id=c.id;
   UPDATE public.external_connections SET provider=i.metadata->>'provider',adapter=i.metadata->>'adapter',endpoint=official_endpoint,current_version_id=i.version_id,status='unverified',last_verified_at=NULL,last_verification_detail=NULL WHERE id=c.id RETURNING * INTO c;
  END IF;
  INSERT INTO public.external_connection_versions(id,connection_id,version,provider,adapter,endpoint,vault_secret_id)
  VALUES(i.version_id,c.id,next_version,c.provider,c.adapter,c.endpoint,i.secret_ref);
 ELSIF action='rebind' THEN
  SELECT version.* INTO v FROM public.external_connection_versions version JOIN public.external_connections connection ON connection.id=version.connection_id
  WHERE version.id=i.version_id AND version.connection_id=i.connection_id AND connection.created_by=i.owner_id AND version.revoked_at IS NULL FOR UPDATE OF version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO c FROM public.external_connections WHERE id=v.connection_id FOR UPDATE;
  -- Explicit re-entry invalidates readiness, retaining all old verification rows.
  INSERT INTO public.external_connection_verifications(connection_id,connection_version_id,status,detail) VALUES(c.id,v.id,'retryable','Owner重新绑定秘密；需要重新验证。');
  IF c.current_version_id=v.id THEN UPDATE public.external_connections SET status='retryable',last_verification_detail='Owner重新绑定秘密；需要重新验证。',last_verified_at=now() WHERE id=c.id RETURNING * INTO c; END IF;
 ELSE RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';
 END IF;
 INSERT INTO local_identity.connection_bindings(version_id,owner_id,secret_ref,store_mode) VALUES(i.version_id,i.owner_id,i.secret_ref,i.store_mode)
 ON CONFLICT(version_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM local_identity.connection_bindings WHERE version_id=i.version_id AND owner_id=i.owner_id AND secret_ref=i.secret_ref AND store_mode=i.store_mode) THEN RAISE EXCEPTION 'Binding conflict' USING ERRCODE='23505'; END IF;
 UPDATE local_identity.connection_intents SET applied_at=now(),result=to_jsonb(c) WHERE owner_id=i.owner_id AND idempotency_key=p_key;
 RETURN to_jsonb(c);
END;
$$;

CREATE FUNCTION local_identity.record_connection_probe(p_id uuid,p_mode text,p_outcome text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.external_connection_versions; c public.external_connections; saved_status text; detail text;
BEGIN
 IF p_mode NOT IN ('live','simulated') OR p_outcome NOT IN ('verified','invalid','retryable') THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023'; END IF;
 SELECT version.* INTO v FROM public.external_connection_versions version JOIN public.external_connections connection ON connection.id=version.connection_id
 WHERE version.id=p_id AND connection.created_by=local_identity.owner_id() AND version.revoked_at IS NULL FOR UPDATE OF version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Version not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO c FROM public.external_connections WHERE id=v.connection_id FOR UPDATE;
 IF c.current_version_id<>v.id THEN RAISE EXCEPTION 'Version changed' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM local_identity.connection_bindings WHERE version_id=v.id AND owner_id=c.created_by AND (p_mode='simulated' OR store_mode='keychain')) THEN RAISE EXCEPTION 'Binding required' USING ERRCODE='22023'; END IF;
 saved_status:=CASE WHEN p_mode='simulated' THEN 'retryable' ELSE p_outcome END;
 detail:=CASE WHEN p_mode='simulated' THEN '仅模拟验证；真实Keychain及在线验证尚未完成。' WHEN p_outcome='verified' THEN '连接验证通过。' WHEN p_outcome='invalid' THEN '连接认证失败。' ELSE '连接暂时不可用，请稍后重试。' END;
 INSERT INTO local_identity.connection_probe_evidence(version_id,owner_id,mode,outcome) VALUES(v.id,c.created_by,p_mode,p_outcome);
 INSERT INTO public.external_connection_verifications(connection_id,connection_version_id,status,detail) VALUES(c.id,v.id,saved_status,detail);
 UPDATE public.external_connections SET status=saved_status,last_verification_detail=detail,last_verified_at=now() WHERE id=c.id;
END;
$$;
REVOKE ALL ON FUNCTION local_identity.connection_version(uuid),local_identity.apply_connection_intent(uuid),local_identity.record_connection_probe(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.connection_version(uuid),local_identity.apply_connection_intent(uuid),local_identity.record_connection_probe(uuid,text,text) TO loop_owner;
CREATE FUNCTION local_identity.lock_owned_connection(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.external_connections WHERE id=p_id AND created_by=local_identity.owner_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found' USING ERRCODE='P0002'; END IF;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION local_identity.lock_owned_connection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.lock_owned_connection(uuid) TO loop_owner;
