import type {PoolClient} from 'pg';
import {ConfigurationError} from './configurationCommands.js';

export interface GenerationBudgetRead {
 accountId:string;
 budget:{trial_video_limit_cents:number;total_limit_cents:number;full_generation_enabled:boolean}|null;
 usedCents:number;
}

export async function readGenerationBudget(c:PoolClient,accountId:string):Promise<GenerationBudgetRead>{
 const budget=(await c.query('SELECT trial_video_limit_cents,total_limit_cents,full_generation_enabled FROM public.generation_account_budgets WHERE account_id=$1',[accountId])).rows[0]??null;
 const usedCents=Number((await c.query('SELECT coalesce(sum(reserved_cents),0) used FROM public.paid_generation_reservations WHERE account_id=$1',[accountId])).rows[0].used);
 return {accountId,budget,usedCents};
}

export async function saveGenerationBudget(c:PoolClient,accountId:string,data:Record<string,unknown>){
 if(!Number.isSafeInteger(data.trialCents)||!Number.isSafeInteger(data.totalCents)||Number(data.trialCents)<1||Number(data.totalCents)<Number(data.trialCents)||Number(data.totalCents)>100000||typeof data.full!=='boolean')throw new ConfigurationError(400,'生成预算须为有效金额，总上限不小于试片上限且不超过1000元。');
 return (await c.query('SELECT to_jsonb(public.set_generation_budget($1,$2,$3,$4)) result',[accountId,data.trialCents,data.totalCents,data.full])).rows[0].result;
}
