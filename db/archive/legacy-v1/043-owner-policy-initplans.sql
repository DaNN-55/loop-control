-- Cache statement-wide Owner identity in the three retained native read
-- policies. Preserve their roles, commands, grants and row predicates.
ALTER POLICY "owners can read their external connections"
ON public.external_connections
USING (created_by = (SELECT local_identity.owner_id()));

ALTER POLICY "owners can read their connection verifications"
ON public.external_connection_verifications
USING (EXISTS (
 SELECT 1 FROM public.external_connections connection
 WHERE connection.id = external_connection_verifications.connection_id
 AND connection.created_by = (SELECT local_identity.owner_id())
));

ALTER POLICY storyboard_audio_selections_owner_read
ON public.storyboard_audio_selections
USING (EXISTS (
 SELECT 1 FROM public.episodes episode
 JOIN public.account_memberships membership ON membership.account_id = episode.account_id
 WHERE episode.id = storyboard_audio_selections.episode_id
 AND membership.user_id = (SELECT local_identity.owner_id())
 AND membership.role = 'owner'::public.member_role
));
