import type {ProductionCapability} from './worker/registeredAdapters.js';
/** Editable intent. Each submitted request owns a validated immutable copy. */
export interface ProductionSelection {
 capability:ProductionCapability;
 provider:string;
 adapter:string;
 model?:string;
 preset?:string;
 connectionVersionId?:string;
}
