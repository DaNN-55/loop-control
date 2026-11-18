import {openAiLanguageModels} from '../languageModels';
import {expect,it,vi} from 'vitest';
import {registeredAdapters} from '../worker/registeredAdapters';
import {buildProductionServiceCatalog} from './serviceCatalog';
import {registeredConnectionModels,defaultConnectionModels} from './connectionModels';
import {createProviderProbe} from '../local-app/providerProbe';
it('registers GPT text service separately from image generation and includes it in connection model settings',()=>{
 const group=buildProductionServiceCatalog({connections:[],versions:[],externalReady:false}).groups.find(g=>String(g.capability)==='language_model');
 expect(group?.label).toBe('大语言模型');
 expect(group?.services).toHaveLength(2);
 expect(group?.services.find(s=>s.provider==='openai')).toMatchObject({provider:'openai',adapter:'openai_responses',models:[...openAiLanguageModels],executable:false});
 expect(registeredConnectionModels('openai','openai_responses')).toEqual(openAiLanguageModels.map(id=>({id,capability:'大语言模型',adapted:true,listed:false})));
 expect(registeredAdapters.productionChoices().find(c=>c.adapter==='openai_images')?.capability).toBe('image');
});
it('verifies text-model access with a read-only request without relying on image permissions',async()=>{
 const transport=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({data:[{id:'gpt-5.6-luna'}]}));
 const probe=createProviderProbe({directory:'/not-used',policySha256:''},transport,undefined,{manualVerification:true});
 expect(await probe.verify({provider:'openai',adapter:'openai_responses',endpoint:'https://api.openai.com/v1',secret:'synthetic-text-key'})).toBe('verified');
 expect(transport).toHaveBeenCalledTimes(1);
 expect(String(transport.mock.calls[0]?.[0])).toBe('https://api.openai.com/v1/models');
});
it('registers and verifies DeepSeek through its model directory without a generation request',async()=>{
 expect(registeredConnectionModels('deepseek','deepseek_responses').map(m=>m.id)).toEqual(['deepseek-flash','deepseek-v4-pro']);
 const transport=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]}));
 const probe=createProviderProbe({directory:'/not-used',policySha256:''},transport,undefined,{manualVerification:true});
 expect(await probe.verify({provider:'deepseek',adapter:'deepseek_responses',endpoint:'https://api.deepseek.com',secret:'synthetic-deepseek-key'})).toBe('verified');
 expect(String(transport.mock.calls[0][0])).toBe('https://api.deepseek.com/models');expect(transport).toHaveBeenCalledTimes(1);
});
it('keeps text service ready independently of image execution availability',()=>{
 const connections=[{id:'text',name:'GPT',provider:'openai',adapter:'openai_responses',current_version_id:'text-v',status:'verified'}];
 const versions=[{id:'text-v',connection_id:'text',provider:'openai',adapter:'openai_responses',is_current:true,revoked_at:null,status:'verified',version:1}];
 const catalog=buildProductionServiceCatalog({connections,versions,externalReady:false,executionByProvider:{openai:false},executionByAdapter:{'openai:openai_responses':true}});
 expect(catalog.groups.find(g=>g.capability==='language_model')?.services.find(s=>s.provider==='openai')?.executable).toBe(true);
 expect(catalog.groups.find(g=>g.capability==='image')?.services[0].executable).toBe(false);
});

it('offers all public supported GPT models while retaining the previous default enablement',()=>{
 const expected=['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','gpt-5.6','gpt-6.1-sol','gpt-6.1-terra'];expect(registeredConnectionModels('openai','openai_responses').map(m=>m.id)).toEqual(expected);expect(defaultConnectionModels('openai','openai_responses').map(m=>m.id)).toEqual(['gpt-5.6-luna']);
});
it('verifies any supported text model through the directory instead of requiring Luna or Flash',async()=>{
 for(const [provider,adapter,endpoint,id] of [['openai','openai_responses','https://api.openai.com/v1','gpt-6.1-sol'],['deepseek','deepseek_responses','https://api.deepseek.com','deepseek-v4-pro']]){const transport=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({data:[{id}]})),probe=createProviderProbe({directory:'/not-used',policySha256:''},transport,undefined,{manualVerification:true});expect(await probe.verify({provider,adapter,endpoint,secret:'synthetic'})).toBe('verified');expect(String(transport.mock.calls[0]?.[0])).toBe(endpoint+'/models');}
});
