import {afterEach,expect,it,vi} from 'vitest';
import {prepareOwnerAvatar} from './avatarUpload';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('rejects unsupported, oversized and undecodable images before saving',async()=>{
 const decode=vi.fn().mockRejectedValue(Error('decode'));vi.stubGlobal('createImageBitmap',decode);
 await expect(prepareOwnerAvatar(new File(['x'],'avatar.svg',{type:'image/svg+xml'}))).rejects.toThrow('PNG、JPEG 或 WebP');
 await expect(prepareOwnerAvatar(new File([new Uint8Array(5*1024*1024+1)],'avatar.png',{type:'image/png'}))).rejects.toThrow('5 MB');expect(decode).not.toHaveBeenCalled();
 await expect(prepareOwnerAvatar(new File(['bad'],'bad.png',{type:'image/png'}))).rejects.toThrow('无法读取');
});
it('crops a raster thumbnail and releases the decoded source',async()=>{
 const close=vi.fn(),drawImage=vi.fn(),bitmap={width:600,height:400,close};vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage} as unknown as CanvasRenderingContext2D);
 const encoded='data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAUAAAAvAAAAAAA=';
 vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue(encoded);
 expect(await prepareOwnerAvatar(new File(['raster'],'photo.png',{type:'image/png'}))).toBe(encoded);
 expect(drawImage).toHaveBeenCalledWith(bitmap,100,0,400,400,0,0,256,256);expect(close).toHaveBeenCalledOnce();
});
