// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createPublicationReader,publicationRequest} from './workspacePublicationProvider';
import {publicationTimelineContext} from './workspacePublicationContext';
import type {OpenChatCutProject} from '../worker/openchatcutProject';
it('uses only retained visible timeline content, with no deleted shot or whole-source transcript',()=>{
 const project={activeTimelineId:'t',assets:[],timelines:[{id:'t',fps:30,items:[{id:'kept',track:'V1',kind:'image',src:'one.png',startFrame:0,durationInFrames:30,loopControlShot:{shotId:'one',clipId:'clip',text:'商品一'}},{id:'hidden',track:'V2',kind:'image',src:'hidden.png',startFrame:0,durationInFrames:30,loopControlShot:{shotId:'two',clipId:'two',text:'隐藏商品'}}],tracks:{V1:{kind:'video'},V2:{kind:'video',hidden:true}},trackOrder:['V1','V2']}]} as unknown as OpenChatCutProject;
 const text=JSON.stringify(publicationTimelineContext(project));expect(text).toContain('商品一');expect(text).not.toContain('隐藏商品');expect(text).not.toContain('已删商品');expect(text).not.toContain('src');
});
it('requests one dedicated editable publication set and validates provider output',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({id:'resp_publication',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title:'保留商品',description:'实际采用画面',tags:['#商品']})}]}]})));
 const input={secret:'synthetic',provider:'openai',model:'gpt-5.6-luna',context:{retained:['商品一']},current:{title:'手改',description:'',tags:[]},instruction:'简短'};
 const req=publicationRequest(input);expect(req.body.instructions).toContain('不编造');expect(req.body.text.format.name).toBe('workspace_publication_v1');expect(req.body).not.toHaveProperty('tools');
 expect((await createPublicationReader(fetcher)(input)).text).toEqual({title:'保留商品',description:'实际采用画面',tags:['商品']});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retains invalid and unknown outcomes instead of fabricating usable publication text',async()=>{
 const input={secret:'synthetic',provider:'openai',model:'gpt-5.6-luna',context:{},current:{title:'保留',description:'',tags:[]},instruction:''};
 await expect(createPublicationReader(async()=>{throw Error('network');})(input)).rejects.toMatchObject({outcome:'unknown'});
 await expect(createPublicationReader(async()=>new Response(JSON.stringify({id:'resp_invalid',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"title":"标题"}'}]}]})))(input)).rejects.toMatchObject({outcome:'failed'});
});
