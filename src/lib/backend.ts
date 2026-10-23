export type Backend='supabase'|'local';
export function selectBackend(value:string|undefined):Backend{
 if(value===undefined || value==='supabase')return 'supabase';
 if(value==='local')return 'local';
 throw Error('未知数据后端；必须显式选择 local 或 supabase。');
}
export const backend=selectBackend(import.meta.env.VITE_LOOP_BACKEND);
