// @vitest-environment node
import {expect,it,vi,beforeEach} from 'vitest';
import type {PoolClient} from 'pg';
import {resolveScriptStudioAttachments} from './scriptStudioAttachments';
const io=vi.hoisted(()=>({verify:vi.fn(),locate:vi.fn(),validate:vi.fn()}));
vi.mock('./episodeFiles',()=>({verifyEpisodeFile:io.verify}));
vi.mock('./episodeStorageLocation',()=>({resolveEpisodeStorageLocation:io.locate}));
vi.mock('./materialAcceptance',()=>({validateImportedMaterial:io.validate}));
const ref={materialRevisionId:'11111111-1111-4111-8111-111111111111',sha256:'a'.repeat(64),mimeType:'image/png' as const,fileSize:8,name:'cup.png'};
const material={id:ref.materialRevisionId,storage_path:'episodes/episode/materials/a-cup.png',source_path:'cup.png',material_type:'image',mime_type:'image/png',file_size:'8',sha256:ref.sha256};
const client=(rows:unknown[])=>({query:vi.fn(async()=>({rows}))}) as unknown as PoolClient;
beforeEach(()=>{vi.resetAllMocks();io.locate.mockResolvedValue({assetRoot:'/resolved/account'});io.verify.mockResolvedValue(Buffer.from([137,80,78,71,13,10,26,10]));io.validate.mockResolvedValue('image/png');});
it('resolves only registered owned material and constructs transient image data',async()=>{
 const result=await resolveScriptStudioAttachments(client([material]),'/media','owner','episode',[ref]);
 expect(result.attachments).toEqual([ref]);expect(result.inputs).toEqual([{...ref,dataUrl:'data:image/png;base64,iVBORw0KGgo='}]);expect(JSON.stringify(result.attachments)).not.toContain('iVBORw0KGgo');
 expect(io.verify).toHaveBeenCalledWith(expect.anything(),'/resolved/account','episode',material.storage_path,ref.sha256,8);
});
it('refuses absent foreign materials before any file read',async()=>{
 await expect(resolveScriptStudioAttachments(client([]),'/media','owner','episode',[ref])).rejects.toThrow(/当前生产单/);expect(io.verify).not.toHaveBeenCalled();
});
it.each([{sha256:'b'.repeat(64)},{file_size:9},{mime_type:'image/jpeg'},{material_type:'video'}])('rejects changed or disguised reference metadata: %j',async change=>{
 await expect(resolveScriptStudioAttachments(client([{...material,...change}]),'/media','owner','episode',[ref])).rejects.toThrow(/变化|图片/);expect(io.verify).not.toHaveBeenCalled();
});
it('rejects corrupt exact bytes even when the registered hash metadata matches',async()=>{
 io.validate.mockRejectedValue(Error('图片无法完整解码'));
 await expect(resolveScriptStudioAttachments(client([material]),'/media','owner','episode',[ref])).rejects.toThrow(/解码/);
});
it('keeps legacy text-only requests independent of material storage',async()=>{
 expect(await resolveScriptStudioAttachments(client([]),'/media','owner','episode',[])).toEqual({attachments:[],inputs:[]});expect(io.locate).not.toHaveBeenCalled();
});

it('reads actual UTF-8 document bytes only for registered reference material',async()=>{
 const bytes=Buffer.from('A script reference with instructions as data.'),document={...ref,mimeType:'text/plain',name:'notes.txt',fileSize:bytes.length};io.verify.mockResolvedValue(bytes);
 const row={...material,mime_type:'text/plain',material_type:'reference',source_path:'notes.txt',file_size:bytes.length};
 expect((await resolveScriptStudioAttachments(client([row]),'/media','owner','episode',[document])).inputs).toEqual([{...document,text:bytes.toString()}]);expect(io.validate).not.toHaveBeenCalled();
 io.verify.mockResolvedValue(Buffer.from([255,254]));await expect(resolveScriptStudioAttachments(client([row]),'/media','owner','episode',[document])).rejects.toThrow(/UTF-8/);
});
it('rejects cumulative document text above 40000 characters without truncating any file',async()=>{
 const refs=Array.from({length:3},(_,index)=>({...ref,materialRevisionId:`${index}1111111-1111-4111-8111-111111111111`,mimeType:'text/plain',name:'notes.txt',fileSize:15000})),rows=refs.map(item=>({...material,id:item.materialRevisionId,mime_type:'text/plain',material_type:'reference',source_path:'notes.txt',file_size:15000}));io.verify.mockResolvedValue(Buffer.from('x'.repeat(15000)));
 await expect(resolveScriptStudioAttachments(client(rows),'/media','owner','episode',refs)).rejects.toThrow(/40000/);
});
