/** Display precision only; native project values are never changed. */
export const workspaceDisplayNumber=(value:number,precision=3)=>Number.isFinite(value)?String(Number(value.toFixed(precision))):'未记录';
