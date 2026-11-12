-- Retired identities remain in immutable history; new connections cannot use them.
CREATE OR REPLACE FUNCTION public.official_external_connection_endpoint(p_provider text,p_adapter text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
 WHEN p_provider='volcengine' AND p_adapter='seedance_video' THEN 'https://ark.cn-beijing.volces.com/api/v3'
 WHEN p_provider='minimax' AND p_adapter='minimax_video' THEN 'https://api.minimax.io'
 WHEN p_provider='kling' AND p_adapter='kling_video' THEN 'https://api-singapore.klingai.com'
 WHEN p_provider='bailian' AND p_adapter='wan_video' THEN 'https://dashscope.aliyuncs.com'
 WHEN p_provider='pexels' AND p_adapter='pexels_video' THEN 'https://api.pexels.com'
 WHEN p_provider='freesound' AND p_adapter='freesound_preview' THEN 'https://freesound.org/apiv2'
 WHEN p_provider='openai' AND p_adapter='openai_images' THEN 'https://api.openai.com/v1'
 WHEN p_provider='volcengine_tts' AND p_adapter='volcengine_tts' THEN 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse'
 END
$$;
CREATE FUNCTION local_identity.reject_retired_blueprint_provider() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.is_active AND NOT NEW.is_snapshot AND EXISTS(SELECT 1 FROM jsonb_each(NEW.policy) p WHERE p.value#>>'{executor,provider}' IN('cloudflare','google_tts')) THEN
  RAISE EXCEPTION 'Provider retired; select another service' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reject_retired_blueprint_provider BEFORE INSERT OR UPDATE OF policy,is_active ON public.account_blueprint_versions FOR EACH ROW EXECUTE FUNCTION local_identity.reject_retired_blueprint_provider();
REVOKE ALL ON FUNCTION local_identity.reject_retired_blueprint_provider() FROM PUBLIC;

-- Removing only retired capabilities must preserve the exact old Episode policy,
-- even when its historical connection no longer qualifies for new production.
CREATE OR REPLACE FUNCTION local_identity.without_retired_provider_capabilities(p_policy jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(p.key,p.value),'{}'::jsonb) FROM jsonb_each(p_policy) p
 WHERE coalesce(p.value#>>'{executor,provider}','') NOT IN('cloudflare','google_tts')
$$;
REVOKE ALL ON FUNCTION local_identity.without_retired_provider_capabilities(jsonb) FROM PUBLIC;
DO $$
DECLARE original text; updated text;
BEGIN
 original:=pg_get_functiondef('public.validate_blueprint_external_connections()'::regprocedure);
 IF strpos(original,'Exact retirement-only edit')>0 THEN RETURN; END IF;
 updated:=replace(original,E'begin\n foreach k',E'begin\n -- Exact retirement-only edit: no other policy fields or references can change.\n if TG_OP=''UPDATE'' and new.policy<>old.policy and new.policy=local_identity.without_retired_provider_capabilities(old.policy) then return new; end if;\n -- Archive an exact copy of this Owner current policy; this grants no execution.\n if new.is_snapshot and not new.is_active and new.archived_at is not null and exists(\n  select 1 from public.accounts a join public.account_blueprint_versions b on b.id=a.current_blueprint_version_id\n  join public.account_memberships m on m.account_id=a.id and m.user_id=local_identity.owner_id() and m.role=''owner''\n  where a.id=new.account_id and b.policy=new.policy\n ) then return new; end if;\n foreach k');
 IF updated=original THEN RAISE EXCEPTION 'Blueprint validator changed; inspect before retirement'; END IF;
 EXECUTE updated;
END $$;
