import type {ProductionService} from '../connections/serviceCatalog';
import type {ProductionSelection} from '../productionSelection';

export function productionModelSelection(services:ProductionService[],value:string,capability:ProductionSelection['capability']):ProductionSelection|null {
 for(const service of services)for(const model of service.models)if(value===`${service.id}:${model}`)return {capability,provider:service.provider,adapter:service.adapter,model,...(service.connectionVersionId?{connectionVersionId:service.connectionVersionId}:{})};
 return null;
}
