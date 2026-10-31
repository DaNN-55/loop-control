/** New creative snapshots exclude retired execution settings; historical records are never rewritten. */
export const blueprintTechnicalKeys = ['asset_root','static_visual','a_roll','b_roll','narration','soundtrack','review','approval_gates','allowed_tools','budgets','executors','capabilities'] as const;
export function creativeAccountRules(value:Record<string,unknown>):Record<string,unknown>{
 return Object.fromEntries(Object.entries(value).filter(([key])=>!(blueprintTechnicalKeys as readonly string[]).includes(key)));
}
