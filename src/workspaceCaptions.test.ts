import {describe,it,expect} from 'vitest';
import {defaultShotCaptionContract} from './shotCaptions';
import {applyWorkspaceCaptionEdit,readWorkspaceCaption} from './workspaceCaptions';
import type {OpenChatCutProject} from './worker/openchatcutProject';
const project=():OpenChatCutProject=>({version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[{id:'shot-one',kind:'image',track:'V1',startFrame:60,durationInFrames:90,transform:{scale:1.2},keyframes:{x:[{frame:0,value:3}]}}],trackOrder:['V1'],tracks:{V1:{kind:'video',name:'video'}},transitions:[],selectedId:null,captionsHidden:false}]});
describe('native workspace captions',()=>{
 it('renders explicit character budgets as manual pages at absolute timeline milliseconds without changing the picture',()=>{
  const original=project(),contract=defaultShotCaptionContract('一二三四五六七八九十','independent');contract.spatial.maxCharactersPerLine=3;contract.spatial.maxLines=2;contract.cues=[{id:'cue-one',text:contract.text,startMs:0,endMs:2000}];
  const next=applyWorkspaceCaptionEdit(original,'shot-one',contract);
  expect(next.timelines[0].items).toEqual(original.timelines[0].items);
  const lane=Object.values(next.timelines[0].tracks).find(t=>t.kind==='caption')!.captions!.sourceEntries[0];
  expect(lane.itemId).toBe('manual:workspace-caption-shot-one');
  expect(lane.words).toEqual([{id:'cue-one~0',text:'一二三\n四五六',start:2000,end:3200},{id:'cue-one~1',text:'七八九\n十',start:3200,end:4000}]);
  expect(readWorkspaceCaption(next,'shot-one')?.contract.spatial.maxCharactersPerLine).toBe(3);
  expect(original.timelines[0].trackOrder).toEqual(['V1']);
 });
});
it('updates the existing lane after the native runtime has normalized caption track IDs',()=>{
 const contract=defaultShotCaptionContract('保留正文','independent');contract.cues=[{id:'one',text:contract.text,startMs:0,endMs:800}];const original=applyWorkspaceCaptionEdit(project(),'shot-one',contract),timeline=original.timelines[0];timeline.tracks['native-normalized-track']=timeline.tracks['workspace-captions'];delete timeline.tracks['workspace-captions'];timeline.trackOrder=['V1','native-normalized-track'];
 contract.spatial.maxCharactersPerLine=2;const changed=applyWorkspaceCaptionEdit(original,'shot-one',contract);
 expect(Object.values(changed.timelines[0].tracks).filter(t=>t.kind==='caption')).toHaveLength(1);expect(readWorkspaceCaption(changed,'shot-one')!.contract.spatial.maxCharactersPerLine).toBe(2);
});
it('keeps other native lanes and their shared allocation policy when editing one lane',()=>{
 const doc=project();doc.timelines[0].items.push({id:'shot-two',kind:'text',track:'V1',startFrame:150,durationInFrames:90});const contract=defaultShotCaptionContract('目标字幕','independent');contract.cues=[{id:'one',text:contract.text,startMs:0,endMs:900}];let initial=applyWorkspaceCaptionEdit(doc,'shot-one',contract);initial=applyWorkspaceCaptionEdit(initial,'shot-two',{...contract,text:'其他字幕',cues:[{id:'two',text:'其他字幕',startMs:0,endMs:900}]});const track=initial.timelines[0].tracks['workspace-captions'];Object.assign(track.captions!,{layoutPolicy:{mode:'auto-stack'}});const other=structuredClone(track.captions!.sourceEntries[1]);Object.assign(track.captions!.sourceEntries[0].style!,{color:'#00ff00'});
 const changed=applyWorkspaceCaptionEdit(initial,'shot-one',{...contract,spatial:{...contract.spatial,anchor:'top-left'}}),captions=changed.timelines[0].tracks['workspace-captions'].captions!;expect(captions.layoutPolicy).toEqual({mode:'auto-stack'});expect(captions.sourceEntries.find(e=>e.id===other.id)).toEqual(other);expect(captions.sourceEntries.find(e=>e.id!==other.id)!.style!.color).toBe('#00ff00');
});
