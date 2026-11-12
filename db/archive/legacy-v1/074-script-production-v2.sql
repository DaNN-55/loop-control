-- New episodes opt in explicitly; no imported or existing episode is enabled.
ALTER TABLE local_identity.input_episodes ADD COLUMN script_template_version integer;
CREATE TABLE local_identity.material_reference_names (
 material_id uuid PRIMARY KEY REFERENCES public.production_material_revisions(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200)
);
ALTER TABLE local_identity.material_reference_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY owned_material_reference_names ON local_identity.material_reference_names TO loop_app
 USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id() AND EXISTS(
 SELECT 1 FROM public.production_material_revisions m JOIN public.episodes e ON e.id=m.episode_id
 JOIN public.account_memberships a ON a.account_id=e.account_id WHERE m.id=material_id AND a.user_id=local_identity.owner_id() AND a.role='owner'));
REVOKE ALL ON local_identity.material_reference_names FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON local_identity.material_reference_names TO loop_app;

CREATE FUNCTION local_identity.script_material_is_approved(p_material uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.production_material_revisions m
 JOIN public.material_revision_approvals a ON a.material_revision_id=m.id
 JOIN public.episodes e ON e.id=m.episode_id JOIN public.account_memberships am ON am.account_id=e.account_id
 WHERE m.id=p_material AND am.user_id=local_identity.owner_id() AND am.role='owner')
$$;
REVOKE ALL ON FUNCTION local_identity.script_material_is_approved(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.script_material_is_approved(uuid) TO loop_owner;

CREATE TABLE local_identity.script_productions (
 episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id),
 script_revision_id uuid NOT NULL REFERENCES public.production_material_revisions(id) ON DELETE CASCADE,
 script_sha256 text NOT NULL CHECK(script_sha256 ~ '^[0-9a-f]{64}$'),
 plan jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 authorization_hash text NOT NULL CHECK(authorization_hash ~ '^[0-9a-f]{64}$'),
 authorized_at timestamptz,
 progress jsonb NOT NULL DEFAULT '{}',
 last_status text NOT NULL DEFAULT '待确认',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE local_identity.script_productions ENABLE ROW LEVEL SECURITY;
CREATE POLICY owned_script_production ON local_identity.script_productions TO loop_app
 USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id() AND EXISTS(
 SELECT 1 FROM local_identity.input_episodes i JOIN public.episodes e ON e.id=i.episode_id
 JOIN public.account_memberships a ON a.account_id=e.account_id
 WHERE i.episode_id=script_productions.episode_id AND i.owner_id=local_identity.owner_id() AND a.user_id=local_identity.owner_id() AND a.role='owner'));
REVOKE ALL ON local_identity.script_productions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON local_identity.script_productions TO loop_app;

CREATE FUNCTION local_identity.record_script_production_configuration(p_episode uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE p local_identity.script_productions; account uuid; BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) THEN RAISE EXCEPTION 'Owned production required' USING ERRCODE='42501'; END IF;
 SELECT s.* INTO p FROM local_identity.script_productions s WHERE s.episode_id=p_episode AND s.owner_id=local_identity.owner_id() AND s.authorization_hash=p_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'Confirmed production required' USING ERRCODE='22023'; END IF;
 SELECT e.account_id INTO account FROM public.episodes e WHERE e.id=p_episode;
 INSERT INTO public.audit_events(account_id,episode_id,event_type,payload,actor_id)
 VALUES(account,p_episode,'script_production_configured',jsonb_build_object('script_sha256',p.script_sha256,'authorization_hash',p.authorization_hash,'enabled',p.enabled),local_identity.owner_id());
END $$;
REVOKE ALL ON FUNCTION local_identity.record_script_production_configuration(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.record_script_production_configuration(uuid,text) TO loop_owner;

-- Only the trusted local application can discover durable delegated scopes.
CREATE FUNCTION local_identity.script_production_scopes()
RETURNS TABLE(episode_id uuid,owner_id uuid,authorization_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.episode_id,p.owner_id,p.authorization_hash FROM local_identity.script_productions p
 JOIN local_identity.input_episodes i ON i.episode_id=p.episode_id AND i.owner_id=p.owner_id
 JOIN public.episodes e ON e.id=p.episode_id AND e.main_script_revision_id=p.script_revision_id
 JOIN public.account_memberships a ON a.account_id=e.account_id AND a.user_id=p.owner_id AND a.role='owner'
 WHERE p.enabled AND p.authorized_at IS NOT NULL AND e.archived_at IS NULL AND e.stage <> 'production_completed'
 AND NOT local_identity.is_historical_episode(e.id)
$$;
REVOKE ALL ON FUNCTION local_identity.script_production_scopes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.script_production_scopes() TO loop_app;

-- V2 visual planning inventories uploaded inputs, even when an older blueprint
-- still contains an image-generation configuration. Run before image freezing.
CREATE FUNCTION local_identity.script_uploaded_visual_inputs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NEW.task_type='prepare_visual_brief' AND EXISTS(SELECT 1 FROM local_identity.input_episodes i WHERE i.episode_id=NEW.episode_id AND i.script_template_version=2) THEN
  NEW.input_snapshot:=NEW.input_snapshot#-'{visual_assets,image_generation}';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION local_identity.script_uploaded_visual_inputs() FROM PUBLIC;
CREATE TRIGGER aa_script_uploaded_visual_inputs BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.script_uploaded_visual_inputs();

ALTER TABLE public.shot_preparation_drafts ADD COLUMN script_narration_gain_db numeric,
 ADD COLUMN script_bgm_gain_db numeric, ADD COLUMN script_sfx_gain_db numeric;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.build_shot_audio_mix(public.shot_preparation_drafts)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.build_shot_audio_mix(', 'FUNCTION public.build_shot_audio_mix_before_script_v2(');
END $$;
CREATE OR REPLACE FUNCTION public.build_shot_audio_mix(p_draft public.shot_preparation_drafts) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$ DECLARE result jsonb; BEGIN
 result:=public.build_shot_audio_mix_before_script_v2(p_draft);
 result:=jsonb_set(result,'{main_voice,gain_db}',to_jsonb(coalesce(p_draft.script_narration_gain_db,0)));
 IF jsonb_typeof(result->'bgm')='object' THEN result:=jsonb_set(result,'{bgm,gain_db}',to_jsonb(coalesce(p_draft.script_bgm_gain_db,-12))); END IF;
 IF jsonb_typeof(result->'sfx')='object' THEN result:=jsonb_set(result,'{sfx,gain_db}',to_jsonb(coalesce(p_draft.script_sfx_gain_db,-6))); END IF;
 RETURN result;
END $$;
CREATE FUNCTION local_identity.save_script_shot_gains(p_episode uuid,p_review uuid,p_shot text,p_voice numeric,p_bgm numeric,p_sfx numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT local_identity.lock_owned_input_episode(p_episode) OR p_voice IS NULL OR p_bgm IS NULL OR p_sfx IS NULL
 OR p_voice NOT BETWEEN -60 AND 12 OR p_bgm NOT BETWEEN -60 AND 12 OR p_sfx NOT BETWEEN -60 AND 12
 OR NOT EXISTS(SELECT 1 FROM public.episodes e JOIN public.review_packages r ON r.episode_id=e.id
 WHERE e.id=p_episode AND e.stage IN ('storyboard_approved','production_ready','render_ready','qc_review') AND r.id=p_review AND r.invalidated_at IS NULL AND r.stage='storyboard_review'
 AND r.revision_number=(SELECT max(revision_number) FROM public.review_packages WHERE episode_id=p_episode AND stage='storyboard_review' AND invalidated_at IS NULL)
 AND EXISTS(SELECT 1 FROM public.approvals a WHERE a.review_package_id=r.id AND a.stage='storyboard_approved' AND a.decision='approved')) THEN RAISE EXCEPTION 'Invalid owned shot mix' USING ERRCODE='22023'; END IF;
 UPDATE public.shot_preparation_drafts SET script_narration_gain_db=p_voice,script_bgm_gain_db=p_bgm,script_sfx_gain_db=p_sfx
 WHERE episode_id=p_episode AND review_package_id=p_review AND shot_id=p_shot;
 IF NOT FOUND THEN RAISE EXCEPTION 'Shot preparation required'; END IF;
END $$;
REVOKE ALL ON FUNCTION local_identity.save_script_shot_gains(uuid,uuid,text,numeric,numeric,numeric), public.build_shot_audio_mix_before_script_v2(public.shot_preparation_drafts) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION local_identity.save_script_shot_gains(uuid,uuid,text,numeric,numeric,numeric) TO loop_owner;
GRANT EXECUTE ON FUNCTION public.build_shot_audio_mix_before_script_v2(public.shot_preparation_drafts) TO loop_owner,loop_worker;

CREATE FUNCTION local_identity.attach_script_render_input() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p local_identity.script_productions; BEGIN
 IF NOT (NEW.input_snapshot ? 'review_render') THEN RETURN NEW; END IF;
 SELECT s.* INTO p FROM local_identity.script_productions s JOIN public.episodes e ON e.id=s.episode_id AND e.main_script_revision_id=s.script_revision_id WHERE s.episode_id=NEW.episode_id;
 IF FOUND THEN NEW.input_snapshot:=NEW.input_snapshot||jsonb_build_object('script_production',jsonb_build_object('authorization_hash',p.authorization_hash,'settings',p.plan->'settings','segments',p.plan->'segments')); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION local_identity.attach_script_render_input() FROM PUBLIC;
CREATE TRIGGER zy_script_production_render_input BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION local_identity.attach_script_render_input();
