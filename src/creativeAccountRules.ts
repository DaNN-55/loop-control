/** New creative snapshots exclude retired execution settings; historical records are never rewritten. */
export const blueprintTechnicalKeys = ['asset_root','static_visual','a_roll','b_roll','narration','soundtrack','review','approval_gates','allowed_tools','budgets','executors','capabilities'] as const;
export function creativeAccountRules(value:Record<string,unknown>):Record<string,unknown>{
 return Object.fromEntries(Object.entries(value).filter(([key])=>!(blueprintTechnicalKeys as readonly string[]).includes(key)));
}

export function hasCreativeRuleValue(value:unknown):boolean {
  if (typeof value==='string') return value.trim().length>0;
  if (Array.isArray(value)) return value.length>0;
  if (value&&typeof value==='object') return Object.keys(value).length>0;
  return value!==null&&value!==undefined;
}

export function resolveCreativeRules(accountRules:Record<string,unknown>,seriesRules:unknown) {
  const account={...accountRules};
  const series=seriesRules&&typeof seriesRules==='object'&&!Array.isArray(seriesRules)
    ? {...seriesRules as Record<string,unknown>}
    : null;
  for (const key of ['positioning','visual_style']) {
    if (hasCreativeRuleValue(series?.[key]) || !hasCreativeRuleValue(account[key])) delete account[key];
    if (series && !hasCreativeRuleValue(series[key])) delete series[key];
  }
  return {account,series};
}

export function creativeMediaPrompt(prompt:string,accountRules:Record<string,unknown>,seriesRules:unknown):string {
  const {account,series}=resolveCreativeRules(accountRules,seriesRules);
  const restrictions=hasCreativeRuleValue(account.restrictions)&&hasCreativeRuleValue(series?.restrictions)
    ? '\n账号和系列的限制与禁用内容须同时遵守。'
    : '';
  return `${prompt.trim()}\n\n账号创作规则：${JSON.stringify(account)}\n系列创作规则：${JSON.stringify(series)}${restrictions}`;
}
