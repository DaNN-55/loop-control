-- Reminder channels are independent; existing category preferences still apply.
-- Missing channel fields preserve legacy behavior without rewriting Owner data.
CREATE OR REPLACE FUNCTION local_identity.native_notification_enabled(p_event uuid,p_category text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE enabled boolean;
BEGIN
 IF session_user<>'loop_app' OR p_category NOT IN('review','failure','delivery') THEN RAISE EXCEPTION 'Invalid notification preference request' USING ERRCODE='42501'; END IF;
 SELECT bool_or(coalesce((p.preferences#>>ARRAY['notifications',p_category])::boolean,true)
  AND coalesce((p.preferences#>>'{notifications,macOS}')::boolean,true)) INTO enabled
 FROM public.audit_events a JOIN public.account_memberships m ON m.account_id=a.account_id AND m.role='owner'
 LEFT JOIN local_identity.owner_preferences p ON p.owner_id=m.user_id
 WHERE a.id=p_event AND (a.event_type<>'connection_verification_failed' OR m.user_id=a.actor_id);
 RETURN coalesce(enabled,false);
END $$;
