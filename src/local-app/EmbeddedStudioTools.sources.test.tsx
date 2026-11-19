import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {EmbeddedStudioTools} from './EmbeddedStudioTools';
import type {ProductionWorkspace} from '../productionWorkspace';
import type {EmbeddedStudioBridge} from './EmbeddedStudioHost';
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('shows the adopted candidate using the native source identity even when the business binding source is null',async()=>{
 const candidate={id:'chosen',kind:'image',usage:'still',shotId:'S1',targetItemId:'selected',clipId:'clip',relativePath:'episodes/e/chosen.png',sha256:'c'.repeat(64),materialRevisionId:'material',status:'adopted',inputFingerprint:'fingerprint',width:360,height:640,durationSeconds:2,currentDurationSeconds:2,pendingConfirmation:false};
 const workspace={id:'w',episodeId:'e',revision:9,stale:false,project:{sha256:'saved'},clips:[{id:'clip',itemId:'selected',shotId:'S1',text:'镜头',source:null}],visualCandidates:[candidate]} as unknown as ProductionWorkspace;
 const document={activeTimelineId:'t',assets:[{id:'native-source',src:'/media/uploads/cache.png',sourceContentHash:candidate.sha256}],timelines:[{id:'t',fps:30,width:360,height:640,tracks:{v:{kind:'video',name:'画面'}},items:[{id:'selected',kind:'image',track:'v',sourceAssetId:'native-source',src:'/media/uploads/cache.png',startFrame:0,durationInFrames:60}]}]};
 const bridge={connected:true,selectedShotId:'S1',selectedItemId:'selected',inspect:vi.fn(async()=>({document}))} as unknown as EmbeddedStudioBridge;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace,serviceCatalog:{groups:[]}})));
 const command=vi.fn();await act(async()=>render(<EmbeddedStudioTools workspace={workspace} bridge={bridge} target="visual" command={command} onChange={()=>{}}/>));
 expect(await screen.findByText('已采用')).toBeTruthy();expect(screen.getByRole('button',{name:'撤回图片采用'})).toBeTruthy();expect(screen.queryByRole('button',{name:'作为镜头画面'})).toBeNull();expect(command).not.toHaveBeenCalled();
});
