// Shared views retain legacy default callbacks for the explicit legacy build.
// Native pages supply HTTP callbacks. Any missed path fails before network I/O.
export const supabase=new Proxy(Object.create(null),{get(){throw Error('旧远端访问路径在本地版本中不可用；请使用本地命令。');}}) as typeof import('../lib/supabase').supabase;
