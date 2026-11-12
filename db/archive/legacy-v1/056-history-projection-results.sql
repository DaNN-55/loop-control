CREATE TABLE local_identity.history_projection_results(
 table_name text NOT NULL,row_key jsonb NOT NULL,payload_sha256 text NOT NULL,
 status text NOT NULL,detail text,applied_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(table_name,row_key,payload_sha256),
 FOREIGN KEY(table_name,row_key,payload_sha256) REFERENCES local_identity.history_versions(table_name,row_key,payload_sha256));
REVOKE ALL ON local_identity.history_projection_results FROM PUBLIC;
ALTER TABLE local_identity.history_projection_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_history_projection ON local_identity.history_projection_results TO loop_owner USING(EXISTS(SELECT 1 FROM local_identity.history_versions v WHERE v.table_name=history_projection_results.table_name AND v.row_key=history_projection_results.row_key AND v.payload_sha256=history_projection_results.payload_sha256 AND v.owner_id=local_identity.owner_id()));
GRANT SELECT ON local_identity.history_projection_results TO loop_owner;
