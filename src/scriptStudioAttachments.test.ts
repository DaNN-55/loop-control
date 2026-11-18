import {expect,it} from 'vitest';
import {scriptStudioImageMime,mergeScriptStudioAttachments,validateScriptStudioAttachmentRefs,scriptStudioAttachmentMaxBytes} from './scriptStudioAttachments';
import {supportsLanguageModelImages} from './languageModels';
const ref={materialRevisionId:'11111111-1111-4111-8111-111111111111',sha256:'a'.repeat(64),mimeType:'image/png',fileSize:8,name:'cup.png'};
it('recognizes the real image signature rather than the extension',()=>{
 expect(scriptStudioImageMime(new Uint8Array([137,80,78,71,13,10,26,10]))).toBe('image/png');
 expect(scriptStudioImageMime(new TextEncoder().encode('renamed image.png'))).toBeNull();
 expect(scriptStudioImageMime(new Uint8Array([255,216,255,224]))).toBe('image/jpeg');
});
it('normalizes a small immutable reference and rejects paths, inline bytes and mismatched metadata',()=>{
 expect(validateScriptStudioAttachmentRefs([ref])).toEqual([ref]);
 for(const value of [[{...ref,dataUrl:'data:secret'}],[{...ref,storagePath:'other/image.png'}],[{...ref,sha256:'bad'}],[{...ref,fileSize:scriptStudioAttachmentMaxBytes+1}],[{...ref,mimeType:'image/svg+xml'}]])expect(()=>validateScriptStudioAttachmentRefs(value)).toThrow();
});
it('keeps insertion order while deduplicating references and refuses conflicting identities',()=>{
 const second={...ref,materialRevisionId:'22222222-2222-4222-8222-222222222222'};
 expect(mergeScriptStudioAttachments([ref],[ref,second])).toEqual([ref,second]);
 expect(()=>mergeScriptStudioAttachments([ref],[{...ref,sha256:'b'.repeat(64)}])).toThrow(/变化/);
});
it('binds the explicitly verified vision models and rejects unsupported or invented names',()=>{
 for(const [provider,model] of [['openai','gpt-5.6-luna'],['openai','gpt-6.1-sol'],['openai','gpt-6.1-terra'],['deepseek','deepseek-flash']])expect(supportsLanguageModelImages(provider,model)).toBe(true);
 expect(supportsLanguageModelImages('deepseek','deepseek-v4-pro')).toBe(false);expect(supportsLanguageModelImages('openai','gpt-6.9-invented')).toBe(false);
});
it('enforces cumulative count and raw image byte limits without discarding earlier references',()=>{
 const references=Array.from({length:17},(_,index)=>({...ref,materialRevisionId:`${String(index).padStart(8,'0')}-1111-4111-8111-111111111111`}));
 expect(()=>validateScriptStudioAttachmentRefs(references)).toThrow(/16/);
 expect(()=>validateScriptStudioAttachmentRefs(references.slice(0,3).map(item=>({...item,fileSize:9*1024*1024})))).toThrow(/24 MiB/);
 expect(mergeScriptStudioAttachments([ref],[{name:ref.name,fileSize:ref.fileSize,mimeType:ref.mimeType,sha256:ref.sha256,materialRevisionId:ref.materialRevisionId}])).toEqual([ref]);
});

it('recognizes only the requested image and document extensions and validates safe UTF-8 document data',async()=>{
 const {scriptStudioAttachmentMimeForName,scriptStudioReadAttachmentText}=await import('./scriptStudioAttachments');
 const kinds:Record<string,string>={'notes.txt':'text/plain','plan.md':'text/markdown','table.csv':'text/csv','facts.json':'application/json','brief.pdf':'application/pdf','draft.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
 for(const [name,mimeType]of Object.entries(kinds)){expect(scriptStudioAttachmentMimeForName(name)).toBe(mimeType);expect(validateScriptStudioAttachmentRefs([{...ref,name,mimeType}])[0].mimeType).toBe(mimeType);}
 expect(scriptStudioAttachmentMimeForName('macro.docm')).toBeNull();expect(scriptStudioAttachmentMimeForName('sample.exe')).toBeNull();
 expect(scriptStudioReadAttachmentText(new TextEncoder().encode('原文优先\n{"scene":"cup"}'),'application/json')).toContain('原文优先');
 expect(()=>scriptStudioReadAttachmentText(new Uint8Array([0xff,0xfe,0x41]),'text/plain')).toThrow(/UTF-8/);
 expect(()=>scriptStudioReadAttachmentText(new TextEncoder().encode('bad\0content'),'text/plain')).toThrow(/文本/);
 expect(()=>scriptStudioReadAttachmentText(new TextEncoder().encode('a'.repeat(20001)),'text/plain')).toThrow(/20000/);
});
it('uses per-format model capabilities instead of treating every attachment as an image',async()=>{
 const {supportsLanguageModelAttachment}=await import('./languageModels');
 expect(supportsLanguageModelAttachment('deepseek','deepseek-v4-pro','text/plain')).toBe(true);
 expect(supportsLanguageModelAttachment('deepseek','deepseek-v4-pro','application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
 expect(supportsLanguageModelAttachment('deepseek','deepseek-flash','application/pdf')).toBe(false);
 expect(supportsLanguageModelAttachment('openai','gpt-5.6-luna','application/pdf')).toBe(true);
 expect(supportsLanguageModelAttachment('deepseek','deepseek-v4-pro','image/png')).toBe(false);
});
