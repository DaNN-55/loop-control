// @vitest-environment node
import {expect,it} from 'vitest';
import {docxFixture} from './scriptStudioDocuments.fixture';
import {readScriptStudioDocx,validateScriptStudioPdf} from './scriptStudioDocuments';
const contentTypes='<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const document=(text='原文 &amp; 参考')=>`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
it('extracts only ordinary DOCX body text without following links or loading embedded images',()=>{
 expect(readScriptStudioDocx(docxFixture())).toBe('原文 & 参考');expect(readScriptStudioDocx(docxFixture(undefined,{method:0}))).toBe('原文 & 参考');
});
it('rejects duplicate documents, path traversal, encryption, unsupported compression and invalid CRC',()=>{
 for(const bytes of [docxFixture([['[Content_Types].xml',contentTypes],['word/document.xml',document()],['word/document.xml',document()]]),docxFixture([['../word/document.xml',document()]]),docxFixture(undefined,{flags:1}),docxFixture(undefined,{method:99}),docxFixture(undefined,{badCrc:true})])expect(()=>readScriptStudioDocx(bytes)).toThrow(/DOCX/);
});
it('rejects zip64, overlap, damaged bounds and expansion bombs before parsing document text',()=>{
 const zip64=docxFixture();zip64.writeUInt16LE(0xffff,zip64.length-12);expect(()=>readScriptStudioDocx(zip64)).toThrow(/DOCX/);
 const overlap=docxFixture(),first=overlap.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])),second=overlap.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),first+4);overlap.writeUInt32LE(0,second+42);expect(()=>readScriptStudioDocx(overlap)).toThrow(/DOCX/);
 expect(()=>readScriptStudioDocx(docxFixture().subarray(0,70))).toThrow(/DOCX/);
 expect(()=>readScriptStudioDocx(docxFixture([['[Content_Types].xml',contentTypes],['word/document.xml',document('x'.repeat(3*1024*1024))]]))).toThrow(/DOCX/);
});
it('rejects XML declarations of external entities, missing body and text beyond the per-document limit',()=>{
 for(const text of ['<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'+document('&xxe;'),'<w:document/>',document('x'.repeat(20001))])expect(()=>readScriptStudioDocx(docxFixture([['[Content_Types].xml',contentTypes],['word/document.xml',text]]))).toThrow(/DOCX|20000/);
});
it('checks PDF signatures and termination without pretending to fully parse PDFs',()=>{
 expect(()=>validateScriptStudioPdf(Buffer.from('%PDF-1.7\n1 0 obj <</Type /Catalog>> endobj\n%%EOF\n'))).not.toThrow();
 for(const bytes of [Buffer.from('renamed pdf'),Buffer.from('%PDF-1.7\nmissing end'),Buffer.from('%PDF-1.7\n/Encrypt 1 0 R\n%%EOF')])expect(()=>validateScriptStudioPdf(bytes)).toThrow(/PDF/);
});
it('validates the dedicated attachment upload without narrowing ordinary reference material imports',async()=>{
 const {validateScriptStudioAttachmentUpload}=await import('./scriptStudioDocuments');
 const input={sourcePath:'notes.txt',sourceKind:'file',materialType:'reference',materialPurpose:'general_reference',mimeType:'text/plain',isMainScript:false};
 expect(validateScriptStudioAttachmentUpload(Buffer.from('笔记'),input)).toBe('text/plain');
 expect(()=>validateScriptStudioAttachmentUpload(Buffer.from('notes'),{...input,materialPurpose:'main_script'})).toThrow();
 expect(()=>validateScriptStudioAttachmentUpload(Buffer.from('notes'),{...input,mimeType:'image/png'})).toThrow();
 expect(()=>validateScriptStudioAttachmentUpload(Buffer.from('notes'),{...input,sourcePath:'fake.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})).toThrow(/DOCX/);
});
