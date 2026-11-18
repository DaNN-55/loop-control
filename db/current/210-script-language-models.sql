-- Expand the receipt constraint without changing existing rows or model enablement.
ALTER TABLE local_identity.script_format_requests DROP CONSTRAINT script_format_requests_model_check;
ALTER TABLE local_identity.script_format_requests ADD CONSTRAINT script_format_requests_model_check
 CHECK (model IN ('gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','gpt-5.6','gpt-6.1-sol','gpt-6.1-terra','deepseek-flash','deepseek-v4-pro'));
