-- Scope reference-only models to the private workspace queue.
DO $migration$
DECLARE
 definition text;
 marker text;
 legacy_basis text := $old$s:=jsonb_set(s,'{inputBasis}',jsonb_build_array(jsonb_build_object('relativePath',src.storage_path,'sha256',src.sha256)));$old$;
BEGIN
 definition:=pg_get_functiondef('local_identity.request_workspace_official_visual(uuid,uuid,text,uuid,text,integer,uuid,integer)'::regprocedure);
 marker:=$old$or (provider_name='kling' and model_name='kling-v3' and visual_mode='keyframes')$old$;
 IF strpos(definition,marker)=0 OR strpos(definition,$old$'visual_mode',visual_mode) end)$old$)=0
    OR strpos(definition,$old$('kling','kling_video','kling-v3'))$old$)=0 THEN RAISE EXCEPTION 'Official workspace video contract changed'; END IF;
 definition:=replace(definition,$old$('kling','kling_video','kling-v3'))$old$,$new$('kling','kling_video','kling-v3'),('kling','kling_video','kling-v3-omni'))$new$);
 definition:=replace(definition,marker,marker||$new$
    or (provider_name='kling' and model_name='kling-v3-omni' and visual_mode='references' and p_first_frame_id is null)$new$);
 definition:=replace(definition,' if visual_inputs is not null then',$new$ if model_name='kling-v3-omni' and visual_inputs is null then
  raise exception 'Omni requires workspace reference inputs' using errcode='22023';
 end if;
 if visual_inputs is not null then$new$);
 definition:=replace(definition,$old$'visual_mode',visual_mode) end)$old$,$new$'visual_mode',visual_mode,
  'reference_ratio',(select request_snapshot->>'referenceRatio' from local_identity.workspace_visual_candidates where id=p_request_id)) end)$new$);
 EXECUTE definition;

 definition:=pg_get_functiondef('local_identity.request_workspace_wan_visual(uuid,uuid,text,uuid,text,integer,uuid)'::regprocedure);
 marker:=$old$ select * into src from public.production_material_revisions where id=p_first_frame_id$old$;
 IF strpos(definition,marker)=0 OR strpos(definition,legacy_basis)=0 OR strpos(definition,'image jsonb; typ text;')=0
    OR strpos(definition,$old$'input_artifacts',jsonb_build_array(image),$old$)=0
    OR strpos(definition,$old$'resolution','720P','audio',false)),$old$)=0
    OR strpos(definition,$old$'wan2.6-i2v','wan2.5-i2v-preview'$old$)=0 THEN RAISE EXCEPTION 'Wan workspace video contract changed'; END IF;
 definition:=replace(definition,'image jsonb; typ text;','image jsonb; visual_inputs jsonb; visual_mode text; reference_ratio text; input_files jsonb; typ text;');
 definition:=replace(definition,$old$'wan2.6-i2v','wan2.5-i2v-preview'$old$,$new$'wan2.6-i2v','wan2.6-r2v','wan2.5-i2v-preview'$new$);
 definition:=replace(definition,marker,$new$ if cfg#>>'{executor,model}'='wan2.6-r2v' then
  select request_snapshot->'visualInputs',request_snapshot->>'videoMode',request_snapshot->>'referenceRatio' into visual_inputs,visual_mode,reference_ratio
   from local_identity.workspace_visual_candidates where id=p_request_id and episode_id=e.id and request_snapshot->>'selectionVersion'='1';
  if visual_mode is distinct from 'references' or jsonb_typeof(visual_inputs) is distinct from 'array'
   or jsonb_array_length(visual_inputs) not between 1 and 5 or p_first_frame_id is not null or p_duration not between 2 and 10
   or not coalesce(reference_ratio in ('16:9','9:16','1:1'),false) then
   raise exception 'Invalid Wan workspace reference inputs' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('artifactType',entry->>'artifactType','relativePath',entry->>'relativePath','sha256',entry->>'sha256','fileSize',entry->'fileSize') order by seq)
   into input_files from jsonb_array_elements(visual_inputs) with ordinality as v(entry,seq);
 else
$new$||marker);
 definition:=replace(definition,legacy_basis,$new$ input_files:=jsonb_build_array(image);
 end if;
 s:=jsonb_set(s,'{inputBasis}',(select jsonb_agg(jsonb_build_object('relativePath',f->>'relativePath','sha256',f->>'sha256')) from jsonb_array_elements(input_files) f));$new$);
 definition:=replace(definition,$old$'input_artifacts',jsonb_build_array(image),$old$,$new$'input_artifacts',input_files,$new$);
 definition:=replace(definition,$old$'resolution','720P','audio',false)),$old$,$new$'resolution','720P','audio',false)||
  case when visual_inputs is null then '{}'::jsonb else jsonb_build_object('visual_inputs',visual_inputs,'visual_mode',visual_mode,'reference_ratio',reference_ratio) end),$new$);
 EXECUTE definition;
END
$migration$;
