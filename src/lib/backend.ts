export type Backend='contract'|'local';
export function selectBackend(value:string|undefined):Backend{
 if(value===undefined || value==='local')return 'local';
 if(value==='contract')return 'contract';
 throw Error('未知数据后端；必须显式选择 local 或 contract。');
}
export const backend=selectBackend(import.meta.env.VITE_LOOP_BACKEND);
