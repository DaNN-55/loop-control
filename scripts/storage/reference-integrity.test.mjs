// @vitest-environment node
import{it,expect}from'vitest';
import{assertReferenceIntegrity}from'./reference-integrity.mjs';
const id='10000000-0000-4000-8000-000000000001',episodeId='10000000-0000-4000-8000-000000000002';
const reference={reference_id:id,episode_id:episodeId,reference_table:'artifacts',source_asset_root:'/original/account',relative_path:'old.mp4',sha256:'a'.repeat(64),file_size:100};
const file={sha256:'b'.repeat(64),bytes:120};
const exception={table:'artifacts',id,episodeId,path:'/original/account/old.mp4',expectedSha256:reference.sha256,expectedBytes:100,actualSha256:file.sha256,actualBytes:120};
const history={version:1,approvalSha256:'c'.repeat(64),exceptions:[exception]};
it('backs up a declared historical failure without changing the reference',()=>{
 const before=JSON.stringify(reference);expect(assertReferenceIntegrity(reference,file,history)).toBe(true);expect(JSON.stringify(reference)).toBe(before);
});
it('accepts matching files normally and rejects missing files',()=>{
 expect(assertReferenceIntegrity(reference,{sha256:reference.sha256,bytes:100})).toBe(false);
 expect(()=>assertReferenceIntegrity(reference,null,history)).toThrow();
});
it.each(['reference_id','episode_id','reference_table','source_asset_root','relative_path','sha256','file_size'])('rejects a changed reference %s even with an approved historical exception',key=>{
 expect(()=>assertReferenceIntegrity({...reference,[key]:key==='file_size'?101:'changed'},file,history)).toThrow();
});
it('rejects unapproved history, changed physical bytes and unlisted exceptions',()=>{
 expect(()=>assertReferenceIntegrity(reference,file)).toThrow();
 expect(()=>assertReferenceIntegrity(reference,file,{...history,approvalSha256:''})).toThrow();
 expect(()=>assertReferenceIntegrity(reference,{...file,sha256:'d'.repeat(64)},history)).toThrow();
 expect(()=>assertReferenceIntegrity(reference,file,{...history,exceptions:[]})).toThrow();
});
