import {isAvatarDataUrl} from '../preferences/preferences';
/** Keep only a small raster thumbnail; original files never leave the browser. */
export async function prepareOwnerAvatar(file:File):Promise<string>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择 PNG、JPEG 或 WebP 图片。');
 if(file.size>5*1024*1024)throw Error('图片不能超过 5 MB，请换一张较小的图片。');
 let bitmap:ImageBitmap;
 try{bitmap=await createImageBitmap(file);}catch{throw Error('图片无法读取，请换一张图片。');}
 try{
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40000000)throw Error('图片尺寸过大，请缩小后重试。');
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const context=canvas.getContext('2d');if(!context)throw Error('图片处理失败，请重试。');
  const side=Math.min(bitmap.width,bitmap.height);
  context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);
  const avatar=canvas.toDataURL('image/webp',0.85);
  if(!isAvatarDataUrl(avatar))throw Error('头像压缩后仍过大，请换一张图片。');
  return avatar;
 }finally{bitmap.close();}
}
