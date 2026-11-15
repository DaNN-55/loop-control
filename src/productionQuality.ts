/** Business classification only; never a Provider quality or generation setting. */
export const businessQualityTiers=['unspecified','low','medium','high'] as const;
export type BusinessQualityTier=typeof businessQualityTiers[number];
export interface ProductionQuality {enabled:boolean;tier:BusinessQualityTier;revision:number}
export const businessQualityLabels:Record<BusinessQualityTier,string>={unspecified:'未指定',low:'低',medium:'中',high:'高'};
export function isBusinessQualityTier(value:unknown):value is BusinessQualityTier{return typeof value==='string'&&businessQualityTiers.includes(value as BusinessQualityTier);}
