export interface PlanningSelection {provider:'codex';adapter:'codex';model:string;harnessId:string;budgetCents:number;allowedTools:string[]}
export interface PlanningSelectionDraft {selection:PlanningSelection|null;revision:number}
