export const episodeBatchLifecycleCommand='applyEpisodeBatchItem';

export type EpisodeBatchLifecycleAction='archive'|'unarchive';

export type EpisodeBatchLifecycleInput={episodeId:string;action:EpisodeBatchLifecycleAction};
