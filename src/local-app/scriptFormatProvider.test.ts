// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {createScriptFormatReader} from './scriptFormatProvider';
const source='# 雨后\n\n## 旁白脚本\n\n雨停了，慢一点回家。';
const recognition={title:'雨后',settings:[],shots:[{narration:'雨停了，慢一点回家。',subtitle:null,visual:'',videoPrompt:'',visualSource:'unassigned',settings:[]}],warnings:[],canRecognize:true};
const response=(suggestion:unknown,extra:Record<string,unknown>={})=>Response.json({id:'resp_fixture',status:'completed',model:'gpt-5.6-luna',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(suggestion)}]}],usage:{input_tokens:100,output_tokens:50},...extra});
it('uses one fixed Responses request, disables storage and returns locally validated shot recognition and actual token usage',async()=>{
 const send=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>response(recognition));
 const result=await createScriptFormatReader(send)({source,diagnostic:'缺少正文',secret:'synthetic-key',model:'gpt-5.6-luna'});
 expect(result).toMatchObject({shots:recognition.shots,usage:{inputTokens:100,outputTokens:50},responseId:'resp_fixture'});
 expect(send).toHaveBeenCalledTimes(1);expect(String(send.mock.calls[0][0])).toBe('https://api.openai.com/v1/responses');
 const init=send.mock.calls[0][1]!,body=JSON.parse(String(init.body));expect(init.redirect).toBe('manual');expect(body).toMatchObject({model:'gpt-5.6-luna',store:false,text:{format:{type:'json_schema',strict:true}}});expect(body).not.toHaveProperty('tools');expect(body).not.toHaveProperty('previous_response_id');
});
it.each([
 ['narration rewrite',{...recognition,shots:[{...recognition.shots[0],narration:'雨停了，快一点回家。'}]}],
 ['invalid format',{...recognition,shots:[]}],
 ['unsupported fields',{...recognition,command:'save'}],
])('rejects %s without returning an applicable suggestion',async(_name,suggestion)=>{
 await expect(createScriptFormatReader(async()=>response(suggestion))({source,diagnostic:'缺少正文',secret:'synthetic',model:'gpt-5.6-luna'})).rejects.toThrow();
});
it('handles refusal and truncated output without applying partial text',async()=>{
 for(const body of [{status:'incomplete'},{output:[{type:'message',content:[{type:'refusal',refusal:'cannot do'}]}]}])await expect(createScriptFormatReader(async()=>response({},body))({source,diagnostic:'missing',secret:'synthetic',model:'gpt-5.6-luna'})).rejects.toThrow();
});
it('does not retry transport failures or redirects',async()=>{
 const send=vi.fn(async()=>{throw Error('network lost');});
 await expect(createScriptFormatReader(send)({source,diagnostic:'missing',secret:'synthetic',model:'gpt-5.6-luna'})).rejects.toMatchObject({outcome:'unknown'});expect(send).toHaveBeenCalledTimes(1);
 const redirect=vi.fn(async()=>new Response(null,{status:302,headers:{Location:'https://example.invalid'}}));
 await expect(createScriptFormatReader(redirect)({source,diagnostic:'missing',secret:'synthetic',model:'gpt-5.6-luna'})).rejects.toThrow();expect(redirect).toHaveBeenCalledTimes(1);
});
it('keeps a response-stream interruption unknown without retrying',async()=>{
 const send=vi.fn(async()=>new Response(new ReadableStream({start(controller){controller.error(Error('connection reset'));}})));
 await expect(createScriptFormatReader(send)({source,diagnostic:'missing',secret:'synthetic',model:'gpt-5.6-luna'})).rejects.toMatchObject({outcome:'unknown'});
 expect(send).toHaveBeenCalledTimes(1);
});
it('uses the documented DeepSeek Responses route, system instructions and stateless format without OpenAI-only parameters',async()=>{
 const send=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>response(recognition,{id:'387b53c1-7ad2-4259-9298-61b139f5bd20',model:'deepseek-flash'}));
 expect(await createScriptFormatReader(send)({source,diagnostic:'缺少正文',secret:'synthetic-deepseek',provider:'deepseek',model:'deepseek-flash'})).toMatchObject({shots:recognition.shots});
 expect(String(send.mock.calls[0][0])).toBe('https://api.deepseek.com/responses');
 const body=JSON.parse(String(send.mock.calls[0][1]?.body));expect(typeof body.instructions).toBe('string');expect(body.reasoning.effort).toBe('none');expect(body).not.toHaveProperty('store');expect(body.text.format).not.toHaveProperty('strict');expect(body).not.toHaveProperty('tools');
});
