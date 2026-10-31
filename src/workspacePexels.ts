import type {PexelsVideoSource,PexelsVideoParameters} from './worker/pexelsVideos.js';
import type {ProductionSelection} from './productionSelection.js';
export interface WorkspacePexelsSource extends PexelsVideoSource {query:string;parameters:PexelsVideoParameters;selection:ProductionSelection;connectionName:string;searchId:string}
export interface WorkspacePexelsRequest {id:string;taskId:string;targetItemId:string;operation:'search'|'preview';query:string;parameters:PexelsVideoParameters;selection:ProductionSelection;connectionName:string;status:string;error:string|null;source?:WorkspacePexelsSource;results?:PexelsVideoSource[];preview?:{relativePath:string;sha256:string;fileSize:number};candidateId?:string}
export interface WorkspacePexelsState {requests:WorkspacePexelsRequest[]}
