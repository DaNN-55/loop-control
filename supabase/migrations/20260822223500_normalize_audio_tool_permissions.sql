update public.account_blueprint_versions blueprint
set policy = jsonb_set(
  blueprint.policy,
  '{narration,allowed_tools}',
  case
    when blueprint.policy -> 'allowed_tools' @> '["read", "write"]'::jsonb then jsonb_build_array('read', 'write')
    when blueprint.policy -> 'allowed_tools' @> '["read"]'::jsonb then jsonb_build_array('read')
    when blueprint.policy -> 'allowed_tools' @> '["write"]'::jsonb then jsonb_build_array('write')
    else '[]'::jsonb
  end
)
where blueprint.policy #>> '{narration,executor,provider}' = 'google_tts'
  and blueprint.policy #>> '{narration,executor,adapter}' = 'google_tts';

update public.account_blueprint_versions blueprint
set policy = jsonb_set(
  blueprint.policy,
  '{soundtrack,allowed_tools}',
  case
    when blueprint.policy -> 'allowed_tools' @> '["read", "write"]'::jsonb then jsonb_build_array('read', 'write')
    when blueprint.policy -> 'allowed_tools' @> '["read"]'::jsonb then jsonb_build_array('read')
    when blueprint.policy -> 'allowed_tools' @> '["write"]'::jsonb then jsonb_build_array('write')
    else '[]'::jsonb
  end
)
where blueprint.policy #>> '{soundtrack,executor,provider}' = 'freesound'
  and blueprint.policy #>> '{soundtrack,executor,adapter}' = 'freesound_preview';
