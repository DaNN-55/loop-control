-- Add a separate text adapter; existing image connection identities remain fixed.
CREATE OR REPLACE FUNCTION public.official_external_connection_endpoint(p_provider text,p_adapter text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
 WHEN p_provider='volcengine' AND p_adapter='seedance_video' THEN 'https://ark.cn-beijing.volces.com/api/v3'
 WHEN p_provider='minimax' AND p_adapter='minimax_video' THEN 'https://api.minimax.io'
 WHEN p_provider='kling' AND p_adapter='kling_video' THEN 'https://api-singapore.klingai.com'
 WHEN p_provider='bailian' AND p_adapter='wan_video' THEN 'https://dashscope.aliyuncs.com'
 WHEN p_provider='pexels' AND p_adapter='pexels_video' THEN 'https://api.pexels.com'
 WHEN p_provider='freesound' AND p_adapter='freesound_preview' THEN 'https://freesound.org/apiv2'
 WHEN p_provider='deepseek' AND p_adapter='deepseek_responses' THEN 'https://api.deepseek.com'
 WHEN p_provider='openai' AND p_adapter IN ('openai_images','openai_responses') THEN 'https://api.openai.com/v1'
 WHEN p_provider='volcengine_tts' AND p_adapter='volcengine_tts' THEN 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse'
 END
$$;
ALTER TABLE public.external_connections DROP CONSTRAINT external_connections_provider_adapter_check;
-- NOT VALID preserves imported legacy rows while enforcing the expanded contract on writes.
ALTER TABLE public.external_connections ADD CONSTRAINT external_connections_provider_adapter_check CHECK (
 (provider,adapter) IN (('pexels','pexels_video'),('freesound','freesound_preview'),('openai','openai_images'),('openai','openai_responses'),('deepseek','deepseek_responses'),('volcengine_tts','volcengine_tts'),('bailian','wan_video'),('volcengine','seedance_video'),('minimax','minimax_video'),('kling','kling_video'))
) NOT VALID;

CREATE TABLE local_identity.script_format_requests (
 owner_id uuid NOT NULL REFERENCES local_identity.owners(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
 script_revision_id uuid,
 connection_version_id uuid NOT NULL REFERENCES public.external_connection_versions(id),
 model text NOT NULL CHECK(model IN ('gpt-5.6-luna','deepseek-flash','deepseek-v4-pro')),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 source_text text NOT NULL CHECK(char_length(source_text) BETWEEN 1 AND 20000),
 diagnostic text NOT NULL,
 request_snapshot jsonb NOT NULL CHECK(jsonb_typeof(request_snapshot)='object' AND octet_length(request_snapshot::text)<=131072),
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','dispatching','completed','failed','unknown')),
 result jsonb CHECK(result IS NULL OR jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,id),
 FOREIGN KEY(episode_id,script_revision_id) REFERENCES public.production_material_revisions(episode_id,id) ON DELETE CASCADE
);
CREATE INDEX script_format_requests_source ON local_identity.script_format_requests(owner_id,episode_id,payload_hash,created_at DESC);
CREATE UNIQUE INDEX script_format_requests_unresolved ON local_identity.script_format_requests(owner_id,payload_hash) WHERE status IN ('prepared','dispatching','unknown');
ALTER TABLE local_identity.script_format_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY script_format_owner ON local_identity.script_format_requests TO loop_app USING(owner_id=local_identity.owner_id()) WITH CHECK(owner_id=local_identity.owner_id());
REVOKE ALL ON local_identity.script_format_requests FROM PUBLIC,loop_app,loop_worker,loop_owner,loop_anonymous;
GRANT SELECT,INSERT,UPDATE ON local_identity.script_format_requests TO loop_app;
