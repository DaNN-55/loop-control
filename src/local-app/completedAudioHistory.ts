// Read-only queue projection, evaluated after selecting the latest task.
// A delivered production keeps unused, settled, unpaid audio failures as history.
// Aliases t (task) and e (episode) are fixed by the two native queue readers.
export const completedAudioHistorySql=`e.stage='production_completed' AND t.task_type='generate_soundtrack'
 AND t.status='failed' AND t.completed_at IS NOT NULL AND t.lease_token IS NULL
 AND EXISTS(SELECT 1 FROM local_identity.workspace_audio_preparations p WHERE p.task_id=t.id)
 AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_audio_preparations p WHERE p.task_id=t.id AND p.adopted_item_id IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.paid_generation_reservations r WHERE r.task_id=t.id)
 AND NOT EXISTS(SELECT 1 FROM public.task_runs r WHERE r.task_id=t.id AND r.status='running')
 AND NOT EXISTS(SELECT 1 FROM local_identity.workspace_publication_holds(t.episode_id) h WHERE h.task_id=t.id)`;
