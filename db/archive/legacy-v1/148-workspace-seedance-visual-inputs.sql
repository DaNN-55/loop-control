-- Extend only the private workspace request. Keep its Owner, connection,
-- authorization and queue fences and preserve the legacy single-frame contract.
DO $migration$
DECLARE
 definition text := pg_get_functiondef('local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)'::regprocedure);
 marker text := 'image jsonb; typ text;';
 old_basis text := $old$s:=jsonb_set(s,'{inputBasis}',jsonb_build_array(jsonb_build_object('relativePath',src.storage_path,'sha256',src.sha256)));$old$;
 old_media text := $old$'input_artifacts',jsonb_build_array(image),$old$;
 old_audio text := $old$'audio',provider_name='minimax')),$old$;
BEGIN
 IF strpos(definition,marker)=0 OR strpos(definition,old_basis)=0 OR strpos(definition,old_media)=0 OR strpos(definition,old_audio)=0
 OR strpos(definition,'select * into src from public.production_material_revisions where id=p_first_frame_id')=0
 THEN RAISE EXCEPTION 'Workspace video input snapshot contract changed'; END IF;

 definition:=replace(definition,marker,'image jsonb; visual_inputs jsonb; visual_mode text; input_files jsonb; typ text;');
 definition:=replace(definition,' select * into src from public.production_material_revisions where id=p_first_frame_id',
 $new$ select request_snapshot->'visualInputs',request_snapshot->>'videoMode' into visual_inputs,visual_mode from local_identity.workspace_visual_candidates where id=p_request_id and episode_id=e.id;
 if visual_inputs is not null then
  if provider_name<>'volcengine' or jsonb_typeof(visual_inputs)<>'array' or jsonb_array_length(visual_inputs) not between 1 and 40 then
   raise exception 'Invalid workspace Seedance inputs' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('artifactType',entry->>'artifactType','relativePath',entry->>'relativePath','sha256',entry->>'sha256','fileSize',entry->'fileSize') order by seq)
   into input_files from jsonb_array_elements(visual_inputs) with ordinality as v(entry,seq);
 end if;
 if visual_inputs is null or p_first_frame_id is not null then
 select * into src from public.production_material_revisions where id=p_first_frame_id$new$);
 definition:=replace(definition,old_basis,
 $new$ end if;
 input_files:=coalesce(input_files,jsonb_build_array(image));
 s:=jsonb_set(s,'{inputBasis}',(select jsonb_agg(jsonb_build_object('relativePath',f->>'relativePath','sha256',f->>'sha256')) from jsonb_array_elements(input_files) f));$new$);
 definition:=replace(definition,old_media,$new$'input_artifacts',input_files,$new$);
 definition:=replace(definition,old_audio,$new$'audio',provider_name='minimax')||case when visual_inputs is null then '{}'::jsonb else jsonb_build_object('visual_inputs',visual_inputs,'visual_mode',visual_mode) end),$new$);
 EXECUTE definition;
END
$migration$;
