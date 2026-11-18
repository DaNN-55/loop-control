import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {createHash,webcrypto} from 'node:crypto';
import {useScriptStudioAttachments,type ScriptStudioAttachmentUpload} from './useScriptStudioAttachments';
import {ScriptStudioAttachmentTrigger,ScriptStudioAttachmentPreviews} from './ScriptStudioAttachmentControls';
import type {ScriptStudioAttachmentMaterial} from '../scriptStudioAttachments';
const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
const file=(name='cup.png')=>new File([bytes],name,{type:'image/png'});
const imported=vi.fn(async(data:ScriptStudioAttachmentUpload)=>({id:'11111111-1111-4111-8111-111111111111',material_type:data.materialType,storage_path:'episodes/e/materials/cup.png',source_path:String(data.sourcePath),mime_type:data.mimeType,file_size:Buffer.from(String(data.contentBase64),'base64').length,sha256:createHash('sha256').update(Buffer.from(String(data.contentBase64),'base64')).digest('hex')}));
function Harness({scope='owner/e/revision/conversation1',supported=true,provider,model}:{scope?:string;supported?:boolean;provider?:string;model?:string}){
 const [materials,setMaterials]=useState<ScriptStudioAttachmentMaterial[]>([]);
 const state=useScriptStudioAttachments({scope,episodeId:'e',supported,provider,model,disabled:false,materials,importMaterial:async data=>{const value=await imported(data);setMaterials(old=>[...old.filter(m=>m.id!==value.id),value]);return value;}});
 return <form aria-label="拍法对话" {...state.dropHandlers}><ScriptStudioAttachmentTrigger state={state}/><ScriptStudioAttachmentPreviews episodeId="e" refs={state.pending} materials={materials} onRemove={state.remove}/><output>{materials.length}个素材</output><button type="button" onClick={()=>state.acknowledge(state.pending)}>acknowledge</button><span>{state.busy?'uploading':'ready'}</span>{(state.error||state.sendError)&&<p role="alert">{state.error||state.sendError}</p>}</form>;
}
afterEach(()=>{cleanup();localStorage.clear();vi.resetAllMocks();vi.unstubAllGlobals();});
it('uploads into materials once, reuses identical bytes, and removes only the message attachment',async()=>{
 vi.stubGlobal('crypto',webcrypto);render(<Harness/>);
 fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[file()]}});
 await screen.findByRole('button',{name:'移除附件 cup.png'});expect(imported).toHaveBeenCalledTimes(1);expect(screen.getByText('1个素材')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[file('renamed.png')]}});await waitFor(()=>expect(screen.getByText('ready')).toBeTruthy());expect(imported).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'移除附件 cup.png'}));expect(screen.queryByRole('button',{name:'移除附件 cup.png'})).toBeNull();expect(screen.getByText('1个素材')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[file()]}});expect(await screen.findByRole('button',{name:'移除附件 cup.png'})).toBeTruthy();expect(imported).toHaveBeenCalledTimes(1);
});
it('accepts file drops and keeps the pending image when the model becomes unsupported',async()=>{
 vi.stubGlobal('crypto',webcrypto);const view=render(<Harness/>);
 fireEvent.drop(screen.getByRole('form',{name:'拍法对话'}),{dataTransfer:{types:['Files'],files:[file()]}});await screen.findByRole('button',{name:'移除附件 cup.png'});
 view.rerender(<Harness supported={false}/>);expect(screen.getByRole('button',{name:'附件'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'移除附件 cup.png'})).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('不支持图片');
});
it('isolates pending drafts by conversation and stores no inline image bytes',async()=>{
 vi.stubGlobal('crypto',webcrypto);const view=render(<Harness/>);fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[file()]}});await screen.findByRole('button',{name:'移除附件 cup.png'});
 expect(JSON.stringify({...localStorage})).not.toContain('iVBORw0KGgo');
 view.rerender(<Harness scope="owner/e/revision/conversation2"/>);expect(screen.queryByRole('button',{name:'移除附件 cup.png'})).toBeNull();
 view.rerender(<Harness/>);expect(await screen.findByRole('button',{name:'移除附件 cup.png'})).toBeTruthy();
});
it('rejects malformed, unsupported and oversized uploads before material registration',async()=>{
 vi.stubGlobal('crypto',webcrypto);render(<Harness/>);
 fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[new File(['not an image'],'fake.png',{type:'image/png'})]}});await screen.findByRole('alert');expect(imported).not.toHaveBeenCalled();
 const huge=file();Object.defineProperty(huge,'size',{value:10*1024*1024+1});fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[huge]}});await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('10 MiB'));expect(imported).not.toHaveBeenCalled();
});

it('keeps a compact attachment popover with one upload slot and opens the native picker from that slot',()=>{
 vi.stubGlobal('crypto',webcrypto);const click=vi.spyOn(HTMLInputElement.prototype,'click').mockImplementation(()=>{});render(<Harness/>);
 fireEvent.click(screen.getByRole('button',{name:'附件'}));const slot=screen.getByRole('button',{name:'选择附件文件'});expect(screen.queryByLabelText('选择本期图片')).toBeNull();expect(slot.textContent).toContain('DOCX');expect(slot.textContent).toContain('10 MiB');fireEvent.click(slot);expect(click).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'选择附件文件'})).toBeNull();
});
it('uploads bounded text documents for text-only models and refuses unsupported PDFs without dropping the text draft',async()=>{
 vi.stubGlobal('crypto',webcrypto);render(<Harness provider="deepseek" model="deepseek-v4-pro"/>);
 fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[new File(['原文优先。'],'notes.txt',{type:'text/plain'})]}});await screen.findByRole('button',{name:'移除附件 notes.txt'});
 expect(imported).toHaveBeenCalledWith(expect.objectContaining({materialType:'reference',materialPurpose:'general_reference',scriptStudioAttachment:true,mimeType:'text/plain'}));
 fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[new File(['%PDF-1.7\n%%EOF'],'brief.pdf',{type:'application/pdf'})]}});await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('PDF'));expect(imported).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'移除附件 notes.txt'})).toBeTruthy();
});
it('handles a drop on the upload slot once instead of also bubbling to the chat drop target',async()=>{
 vi.stubGlobal('crypto',webcrypto);render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'附件'}));fireEvent.drop(screen.getByRole('button',{name:'选择附件文件'}),{dataTransfer:{types:['Files'],files:[file()]}});await screen.findByRole('button',{name:'移除附件 cup.png'});expect(imported).toHaveBeenCalledTimes(1);
});

it('clears the previous upload error after successfully acknowledging the pending attachments',async()=>{
 vi.stubGlobal('crypto',webcrypto);render(<Harness/>);fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:[file()]}});await screen.findByRole('button',{name:'移除附件 cup.png'});
 fireEvent.change(screen.getByLabelText('上传附件'),{target:{files:Array.from({length:5},()=>file())}});expect(await screen.findByRole('alert')).toHaveProperty('textContent','每次最多上传4个附件。');
 fireEvent.click(screen.getByRole('button',{name:'acknowledge'}));expect(screen.queryByRole('button',{name:'移除附件 cup.png'})).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
});
