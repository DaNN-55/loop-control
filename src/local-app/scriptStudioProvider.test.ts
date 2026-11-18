// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {createScriptStudioReader,scriptStudioRequest} from './scriptStudioProvider';
const source='一个人走进咖啡馆，坐下等待朋友。';
const input={source,targetDuration:15,mode:'optimize' as const,instruction:'',model:'gpt-5.6-luna',provider:'openai',secret:'synthetic-secret'};
const response=(plan:unknown)=>Response.json({id:'resp_fixture',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}],usage:{input_tokens:123,output_tokens:45}});
const direction={title:'等待',summary:'通过两个景别表现等待。',sourceUse:'画面描述。',settings:[],shots:[{title:'进入',timingWeight:1,narrationEnabled:false,captionsEnabled:false,narration:'',subtitle:null,visual:'进入咖啡馆。',videoPrompt:'中景跟随。',camera:'中景跟随',visualSource:'unassigned',settings:[]},{title:'等待',timingWeight:2,narrationEnabled:false,captionsEnabled:false,narration:'',subtitle:null,visual:'坐下等待。',videoPrompt:'固定近景。',camera:'固定近景',visualSource:'unassigned',settings:[]}],changes:[],warnings:[]};
it('compiles relative rhythm and individual switches into a fixed total without model summary duplication',async()=>{
 const value=await createScriptStudioReader(async()=>response(direction))(input);
 expect(value.plan.durationSeconds).toBe(15);expect(value.plan.shots.reduce((n,s)=>n+Math.round(s.durationSeconds*100),0)).toBe(1500);
 expect(value.plan.shots[1].durationSeconds).toBeGreaterThan(value.plan.shots[0].durationSeconds);
 expect(value.plan).toMatchObject({narrationEnabled:false,captionsEnabled:false});
});
it('fixes an unspecified total to the displayed estimate before proposing shot timings',async()=>{
 const value=await createScriptStudioReader(async()=>response(direction))({...input,targetDuration:null});
 expect(value.plan.durationSeconds).toBe(6);expect(value.plan.shots.reduce((n,s)=>n+Math.round(s.durationSeconds*100),0)).toBe(600);
});
it('sends exactly one bounded stateless filming request to the fixed provider and returns locally validated usage',async()=>{
 const send=vi.fn(async()=>response(direction)),value=await createScriptStudioReader(send)(input);
 expect(value.plan.shots).toHaveLength(2);expect(value.usage.inputTokens).toBe(123);expect(send).toHaveBeenCalledTimes(1);
 const [url,init]=send.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://api.openai.com/v1/responses');
 const body=JSON.parse(String(init.body));expect(body.store).toBe(false);expect(body.text.format.name).toBe('script_studio_direction_v2');expect(body.instructions).toContain('默认优化');expect(body).not.toHaveProperty('tools');
 for(const name of ['narrationEnabled','captionsEnabled','durationSeconds','canProceed'])expect(body.text.format.schema.properties).not.toHaveProperty(name);
 expect(body.text.format.schema.properties.shots.items.properties).toMatchObject({narrationEnabled:{type:'boolean'},captionsEnabled:{type:'boolean'},timingWeight:{type:'integer',minimum:1,maximum:1000}});
});
it('rejects independent absolute totals and spoken rewrites instead of trusting model output',async()=>{
 await expect(createScriptStudioReader(async()=>response({...direction,durationSeconds:20}))(input)).rejects.toThrow(/结构/);
 await expect(createScriptStudioReader(async()=>response({...direction,shots:[{...direction.shots[0],narrationEnabled:true,narration:'另一个人离开。'}]}))(input)).rejects.toThrow(/原文/);
});
it('does not retry an unknown dispatch or redirect',async()=>{
 const send=vi.fn(async()=>{throw Error('connection lost')});await expect(createScriptStudioReader(send)(input)).rejects.toMatchObject({outcome:'unknown'});expect(send).toHaveBeenCalledTimes(1);
 const redirected=vi.fn(async()=>new Response(null,{status:302}));await expect(createScriptStudioReader(redirected)(input)).rejects.toMatchObject({outcome:'failed'});expect(redirected).toHaveBeenCalledTimes(1);
});
it.each(['openai','deepseek'])('constrains %s setting names to executable fields instead of request metadata',provider=>{
 const {schema}=scriptStudioRequest({...input,provider,model:provider==='openai'?input.model:'deepseek-flash'}).body.text.format;
 const globalFields=schema.properties.settings.items.anyOf.flatMap(item=>item.properties.field.enum);
 const shotFields=schema.properties.shots.items.properties.settings.items.anyOf.flatMap(item=>item.properties.field.enum);
 expect(globalFields).not.toContain('画幅');expect(globalFields).toContain('转场');expect(shotFields).toContain('动画');
 for(const field of ['targetDuration','durationSeconds','mode','source','镜头时长（秒）','生成时长（秒）','首帧素材','口播启用','旁白启用','字幕']){expect(globalFields).not.toContain(field);expect(shotFields).not.toContain(field);}
 for(const field of ['画幅','背景音乐素材','字幕样式','封面素材','旁白语言'])expect(shotFields).not.toContain(field);
});
it('rejects misplaced request metadata before converting a model plan into the internal script',async()=>{
 const plan={...direction,settings:[{field:'targetDuration',value:'15'}]};
 const send=vi.fn(async()=>response(plan));
 await expect(createScriptStudioReader(send)(input)).rejects.toMatchObject({outcome:'failed',message:'拍法包含不支持的全局制作设置：targetDuration'});
 expect(send).toHaveBeenCalledOnce();
});
it('retains bounded rejected model JSON, response identity and usage without making it adoptable',async()=>{
 const invalid={...direction,shots:[{...direction.shots[0],timingWeight:0}]};
 await expect(createScriptStudioReader(async()=>response(invalid))(input)).rejects.toMatchObject({outcome:'failed',diagnostic:{modelOutput:invalid,responseId:'resp_fixture',usage:{inputTokens:123,outputTokens:45}}});
});
it('does not ask the model to invent execution readiness or unprovided production defaults',async()=>{
 const value=await createScriptStudioReader(async()=>response(direction))(input);expect(value.plan.canProceed).toBe(true);
 await expect(createScriptStudioReader(async()=>response({...direction,canProceed:false}))(input)).rejects.toThrow(/结构/);
 await expect(createScriptStudioReader(async()=>response({...direction,settings:[{field:'画幅',value:'竖屏9:16'}]}))(input)).rejects.toThrow(/制作设置：画幅/);
 const schema=scriptStudioRequest(input).body.text.format.schema;
 const animation=schema.properties.settings.items.anyOf.find(item=>item.properties.field.enum.includes('动画'))!;
 expect(animation.properties.value.enum).toEqual(['无','慢推','拉远']);
});
