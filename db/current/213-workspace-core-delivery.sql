-- Core completion keeps exact video/project/check identity while publication inputs are optional.
DO $$
DECLARE definition text; original text;
BEGIN
 definition:=pg_get_functiondef('local_identity.execute_managed_worker_command(text,jsonb)'::regprocedure);
 original:=definition;
 definition:=replace(definition,
  'jsonb_array_length(p_args#>''{p_result,artifacts}'')<>4',
  'jsonb_array_length(p_args#>''{p_result,artifacts}'')<>(SELECT count(*)+1 FROM jsonb_array_elements(delivery_task.input_snapshot#>''{workspace_delivery,artifacts}'') a WHERE a->>''artifactType'' IN (''cover'',''metadata'',''final_qc_report''))');
 definition:=replace(definition,
  '''protocol'',''publish-package/v2''',
  '''protocol'',coalesce(delivery_task.input_snapshot#>>''{workspace_delivery,version}'',''publish-package/v2'')');
 IF definition=original OR position('count(*)+1' IN definition)=0 THEN RAISE EXCEPTION 'Workspace delivery completion contract changed'; END IF;
 EXECUTE definition;
END $$;
