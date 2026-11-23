export const episodeBatchLifecycleCommand='applyEpisodeBatchItem';

export type EpisodeBatchLifecycleAction='rename'|'archive'|'unarchive';

export type EpisodeBatchLifecycleInput={episodeId:string}&(
 {action:'rename';expectedTitle:string;title:string} |
 {action:'archive'|'unarchive'}
);
