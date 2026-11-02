export type NotificationKind = 'review' | 'failure' | 'delivery';
export interface OwnerPreferences {
  displayName: string;
  avatar: string | null;
  language: 'zh-CN';
  appearance: 'light' | 'dark' | 'system';
  compactRows: boolean;
  notifications: Record<NotificationKind, boolean> & {inApp?:boolean;macOS?:boolean};
}
export const defaultOwnerPreferences: OwnerPreferences = {
  displayName: '', avatar: null, language: 'zh-CN', appearance: 'light', compactRows: true,
  notifications: {review: true, failure: true, delivery: true,inApp:true,macOS:true},
};
/** Validate at the API boundary, including JSON loaded from storage. */
export function parseOwnerPreferences(value: unknown): OwnerPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('偏好格式无效。');
  const p = value as Record<string, unknown>;
  const n = p.notifications as Record<string, unknown> | undefined;
  if (Object.keys(p).some(key=>!['displayName','avatar','language','appearance','compactRows','notifications'].includes(key)) ||
      typeof p.displayName !== 'string' || p.displayName.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(p.displayName) ||
      p.language !== 'zh-CN' || !['light','dark','system'].includes(String(p.appearance)) || typeof p.compactRows !== 'boolean' ||
      !n || typeof n !== 'object' || Array.isArray(n) || Object.keys(n).some(key=>!['review','failure','delivery','inApp','macOS'].includes(key)) ||
      ['review','failure','delivery'].some(key=>typeof n[key] !== 'boolean') ||
      ['inApp','macOS'].some(key=>key in n&&typeof n[key]!=='boolean')) throw Error('偏好字段无效。');
  const avatar = p.avatar ?? null;
  if(avatar!==null&&!isAvatarDataUrl(avatar))throw Error('头像须为不超过 64 KB 的 PNG、JPEG 或 WebP 图片。');
  return {...p,avatar,displayName:p.displayName.trim(),notifications:{...n,inApp:n.inApp??true,macOS:n.macOS??true}} as OwnerPreferences;
}

export const maxAvatarBytes = 64 * 1024;
export function isAvatarDataUrl(value:unknown):value is string {
  if(typeof value!=='string'||value.length>Math.ceil(maxAvatarBytes/3)*4+32)return false;
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match||match[2].length%4!==0)return false;
  const bytes=match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0);
  if(bytes>maxAvatarBytes)return false;
  const prefix=atob(match[2].slice(0,16));
  return match[1]==='png'?prefix.startsWith('\x89PNG\r\n\x1a\n'):match[1]==='jpeg'?prefix.startsWith('\xff\xd8\xff'):prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WEBP';
}
