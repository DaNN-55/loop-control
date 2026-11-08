import {defaultWanModel} from '../wanVideoModels.js';
import {productionCapabilityLabels,registeredAdapters,type ProductionCapability,type RegisteredProductionChoice} from '../worker/registeredAdapters.js';

export const providerDisplayNames:Record<string,string>={pexels:'Pexels',freesound:'Freesound',openai:'OpenAI',cloudflare:'Cloudflare',google_tts:'Google Cloud',volcengine_tts:'豆包语音',bailian:'阿里云百炼',volcengine:'火山引擎',minimax:'MiniMax',kling:'可灵'};

export interface ProductionService extends RegisteredProductionChoice {
  id: string;
  authenticationType: string | null;
  connectionId: string | null;
  connectionName: string | null;
  connectionVersionId: string | null;
  connectionVersion: number | null;
  status: string;
  executable: boolean;
  unavailableReason: string | null;
}
export interface ProductionServiceCatalog {
  version: 1;
  groups: {capability: ProductionCapability; label: string; services: ProductionService[]}[];
}
interface CatalogConnection {id:string;name:string;provider:string;adapter:string;current_version_id:string|null;status:string;last_verification_detail?:string|null}
interface CatalogVersion {id:string;connection_id:string;provider:string;adapter:string;is_current:boolean;revoked_at:string|null;status:string;version:number;secretState?:string}
/** Projects registered facts and this Owner's exact current versions; never reads secrets. */
export function buildProductionServiceCatalog(input:{connections:readonly CatalogConnection[];versions:readonly CatalogVersion[];externalReady:boolean;executionByProvider?:Readonly<Record<string,boolean>>;executionIssues?:Readonly<Record<string,string|null>>;localReadiness?:Readonly<Record<string,boolean>>;enabledModels?:Readonly<Record<string,readonly string[]>>}): ProductionServiceCatalog {
  const choices=registeredAdapters.productionChoices();
  return {version:1,groups:(Object.entries(productionCapabilityLabels) as [ProductionCapability,string][]).map(([capability,label])=>({capability,label,services:choices.filter(choice=>choice.capability===capability).flatMap(choice=>{
    const connections=input.connections.filter(connection=>connection.provider===choice.provider&&connection.adapter===choice.adapter);
    return (connections.length?connections:[null]).map(connection=>{
      const enabled=(connection?input.enabledModels?.[connection.id]:undefined)??(choice.provider==='bailian'?[defaultWanModel]:undefined);
      const models=enabled===undefined?choice.models:choice.models.filter(model=>enabled.includes(model));
      const version=connection?input.versions.find(version=>version.id===connection.current_version_id&&version.connection_id===connection.id&&version.provider===choice.provider&&version.adapter===choice.adapter):undefined;
      const unavailableReason=choice.connection.kind==='none'
        ? input.localReadiness?.[choice.identityKey]===true?null:'尚无本机执行环境就绪证据。'
        : !connection?'尚未添加连接。'
        : !version||!version.is_current?'当前连接版本不可用。'
        : version.revoked_at?'当前连接版本已撤销。'
        : version.secretState==='unbound'?'本机密钥未绑定。'
        : version.status!=='verified'?connection.last_verification_detail||'连接尚未验证通过。'
        : !(input.executionByProvider?.[choice.provider]??input.externalReady)?input.executionIssues?.[choice.provider]??'当前执行网络不可用。'
        : choice.models.length&&!models.length?'尚未启用模型，请在更多操作中设置。':null;
      return {...choice,models,id:choice.identityKey+':'+(version?.id??connection?.id??'unconnected'),authenticationType:choice.connection.kind==='owner_managed'?choice.connection.type:null,connectionId:connection?.id??null,connectionName:connection?.name??null,connectionVersionId:version?.id??null,connectionVersion:version?.version??null,status:version?.status??connection?.status??'unconnected',executable:unavailableReason===null,unavailableReason};
    });
  })}))};
}
