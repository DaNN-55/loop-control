-- Extend only the two model allow-lists; retain the current queue, exact
-- executor/task match, confirmations, retry, reservation and namespace rules.
DO $models$
DECLARE original text; signature text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['local_identity.queue_workspace_images(uuid)','local_identity.namespace_workspace_image_task()'] LOOP
  original:=pg_get_functiondef(signature::regprocedure);
  IF strpos(original,$old$NOT IN ('gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08')$old$)=0 THEN RAISE EXCEPTION 'Image model allow-list changed: %',signature;END IF;
  EXECUTE replace(original,$old$NOT IN ('gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08')$old$,$new$NOT IN ('gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08','gpt-image-2.6-sunburst','gpt-image-2.6-flare')$new$);
 END LOOP;
END $models$;
