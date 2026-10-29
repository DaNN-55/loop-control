-- Native shot membership survives deleting any one of its visual instances.
ALTER TABLE local_identity.workspace_caption_evidence ADD COLUMN shot_id text;
UPDATE local_identity.workspace_caption_evidence e SET shot_id=b.value->>'shotId'
FROM local_identity.production_workspaces w CROSS JOIN LATERAL jsonb_array_elements(w.bindings) b
WHERE w.id=e.workspace_id AND b.value->>'id'=e.clip_id::text;
-- Preserve orphaned historical evidence without assigning it to a different shot.
UPDATE local_identity.workspace_caption_evidence SET shot_id='legacy-'||clip_id::text WHERE shot_id IS NULL;
WITH ranked AS (SELECT ctid,row_number() OVER(PARTITION BY workspace_id,shot_id ORDER BY confirmed_at DESC NULLS LAST,clip_id) n FROM local_identity.workspace_caption_evidence)
DELETE FROM local_identity.workspace_caption_evidence e USING ranked r WHERE e.ctid=r.ctid AND r.n>1;
ALTER TABLE local_identity.workspace_caption_evidence ALTER COLUMN shot_id SET NOT NULL;
ALTER TABLE local_identity.workspace_caption_evidence DROP CONSTRAINT workspace_caption_evidence_pkey;
ALTER TABLE local_identity.workspace_caption_evidence ADD PRIMARY KEY(workspace_id,shot_id);
