-- Extend exact image model identities without replacing the current queue,
-- confirmation, account-budget retirement, retry or storage namespace rules.
DO $models$
DECLARE original text; changed text;
BEGIN
 original:=pg_get_functiondef('local_identity.queue_workspace_images(uuid)'::regprocedure);
 IF strpos(original,$old$cfg#>>'{executor,model}'<>'gpt-image-2'$old$)=0
 OR strpos(original,$old$1,'openai','gpt-image-2','workspace-image-v1'$old$)=0 THEN
  RAISE EXCEPTION 'Image model queue contract changed';
 END IF;
 changed:=replace(original,$old$cfg#>>'{executor,model}'<>'gpt-image-2'$old$,
  $new$coalesce(cfg#>>'{executor,model}','') NOT IN ('gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08')$new$);
 changed:=replace(changed,$old$1,'openai','gpt-image-2','workspace-image-v1'$old$,
  $new$1,'openai',cfg#>>'{executor,model}','workspace-image-v1'$new$);
 EXECUTE changed;
 original:=pg_get_functiondef('local_identity.namespace_workspace_image_task()'::regprocedure);
 IF strpos(original,$old$NEW.model<>'gpt-image-2'$old$)=0 THEN
  RAISE EXCEPTION 'Image task namespace contract changed';
 END IF;
 changed:=replace(original,$old$NEW.model<>'gpt-image-2'$old$,
  $new$NEW.model NOT IN ('gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare-2026-09-08') OR NEW.model IS DISTINCT FROM NEW.input_snapshot#>>'{executor,model}'$new$);
 EXECUTE changed;
END $models$;
