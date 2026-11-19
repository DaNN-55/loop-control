import type {ProductionCapability} from '../worker/registeredAdapters';
import type {ProductionSelection} from '../productionSelection';
import type {ProductionServiceCatalog} from '../connections/serviceCatalog';
import {localRequest} from './client';

export interface ConnectionSetupSelection {connectionId:string;versionId:string;modelId?:string}
export interface ConnectionSetupRequest {capability:ProductionCapability;onUse:(selection:ConnectionSetupSelection)=>void|Promise<void>}
export function requestConnectionSetup(request:ConnectionSetupRequest){
 window.dispatchEvent(new CustomEvent<ConnectionSetupRequest>('open-external-connections',{detail:request}));
}
/** Read the actual current directory; never replace the requested service or model. */
export async function readConfiguredService(capability:ProductionCapability,selection:ConnectionSetupSelection){
 const {serviceCatalog}=await localRequest('connections') as {serviceCatalog:ProductionServiceCatalog};
 const service=serviceCatalog.groups.find(g=>g.capability===capability)?.services.find(s=>s.connectionId===selection.connectionId&&s.connectionVersionId===selection.versionId&&s.executable);
 if(!service||selection.modelId&&!service.models.includes(selection.modelId)||service.mode==='generation'&&!selection.modelId)throw Error('所选服务或模型已变化，请重新核对制作服务。');
 const production:ProductionSelection={capability,provider:service.provider,adapter:service.adapter,connectionVersionId:selection.versionId,...(selection.modelId?{model:selection.modelId}:{})};
 window.dispatchEvent(new Event('loop-production-catalog-changed'));
 return {service,selection:production};
}
