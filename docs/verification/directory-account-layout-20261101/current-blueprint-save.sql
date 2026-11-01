CREATE OR REPLACE FUNCTION public.update_current_blueprint(p_account_id uuid, p_policy jsonb)
 RETURNS account_blueprint_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.accounts;b public.account_blueprint_versions;next_version integer;
BEGIN
 IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Blueprint policy must be a JSON object' USING ERRCODE='22023';END IF;
 SELECT account.* INTO a FROM public.accounts account JOIN public.account_memberships m ON m.account_id=account.id AND m.user_id=local_identity.owner_id() AND m.role='owner' WHERE account.id=p_account_id FOR UPDATE OF account;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner membership is required to update a blueprint' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.account_blueprint_versions WHERE id=a.current_blueprint_version_id AND account_id=a.id AND is_active AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The current blueprint is unavailable' USING ERRCODE='22023';END IF;
 p_policy:=public.creative_account_rules(p_policy);
 IF b.policy IS DISTINCT FROM p_policy AND (EXISTS(SELECT 1 FROM public.episodes WHERE blueprint_version_id=b.id) OR EXISTS(SELECT 1 FROM local_identity.episode_creation_intents WHERE blueprint_version_id=b.id AND result IS NULL)) THEN
  SELECT coalesce(max(version),0)+1 INTO next_version FROM public.account_blueprint_versions WHERE account_id=a.id;
  UPDATE public.account_blueprint_versions SET is_active=false,archived_at=now(),is_snapshot=true WHERE id=b.id;
  INSERT INTO public.account_blueprint_versions(account_id,version,policy,is_active) VALUES(a.id,next_version,p_policy,true) RETURNING * INTO b;
  UPDATE public.accounts SET current_blueprint_version_id=b.id WHERE id=a.id;
 ELSIF b.policy IS DISTINCT FROM p_policy THEN
  UPDATE public.account_blueprint_versions SET policy=p_policy WHERE id=b.id RETURNING * INTO b;
 END IF;
 INSERT INTO public.audit_events(account_id,event_type,payload,actor_id) VALUES(a.id,'blueprint_policy_updated',jsonb_build_object('blueprint_version_id',b.id,'version',b.version),local_identity.owner_id());RETURN b;
END $function$