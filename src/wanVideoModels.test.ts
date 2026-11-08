import {expect,it} from 'vitest';
import {wanReferenceModel,wanVideoModel,wanVideoModels,wanVideoParameters,wanProviderDuration,defaultWanModelSettings,isWanVideoRequest,wanVideoSettingsError} from './wanVideoModels';
it.each(Object.keys(wanVideoModels))('builds an admitted request for %s using its duration and parameter contract',model=>{
 const media=model===wanReferenceModel?{reference_urls:['https://media.example.com/example.jpg']}:{img_url:'data:image/png;base64,AA=='};
 const p=wanVideoModel(model)!,settings=defaultWanModelSettings(model),parameters=wanVideoParameters(model,p.durations[0],settings);
 expect(isWanVideoRequest({model,input:{prompt:'缓慢推进',...media},parameters})).toBe(true);
 expect('audio' in parameters?parameters.audio:undefined).toBe(p.audio==='optional'?false:undefined);expect(parameters.duration).toBe(p.fixedDuration?undefined:p.durations[0]);
 expect(isWanVideoRequest({model,input:{prompt:'x',...media},parameters:{...parameters,api_key:'forbidden'}})).toBe(false);
});
it('uses discrete provider durations without truncating adopted voice or silently changing manual input',()=>{
 expect(wanProviderDuration('wan2.5-i2v-preview',6.2,true)).toBe(10);expect(wanProviderDuration('wan2.5-i2v-preview',6,false)).toBeUndefined();expect(wanProviderDuration('wan2.2-i2v-plus',5.1,true)).toBeUndefined();
 expect(wanVideoSettingsError('wan2.6-i2v',{...defaultWanModelSettings('wan2.6-i2v'),audio:false})).toContain('固定生成声音');
 expect(wanVideoSettingsError('wan2.2-i2v-plus',defaultWanModelSettings('wan2.6-i2v-flash'))).toContain('1080P');
 expect(wanVideoSettingsError('wan2.5-i2v-preview',{...defaultWanModelSettings('wan2.5-i2v-preview'),promptExtend:true,shotType:'multi'})).toContain('多镜头');
 expect(wanVideoModel('wan2.7-i2v')).toBeUndefined();expect(wanVideoModel('unregistered-i2v')).toBeUndefined();
});
