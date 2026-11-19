import {afterEach,expect,it,vi} from 'vitest';
import {readConfiguredService,requestConnectionSetup} from './connectionSetup';
import type {ConnectionSetupRequest} from './connectionSetup';
const service={id:'exact-service',provider:'openai',adapter:'openai_images',mode:'generation',connectionId:'connection',connectionVersionId:'version',models:['gpt-image-2'],executable:true};
function directory(services=[service]){vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'image',services}]}})));}
afterEach(()=>vi.unstubAllGlobals());
it('carries capability and an explicit return callback without any request',()=>{
 const callback=vi.fn(),event=vi.fn(),request:ConnectionSetupRequest={capability:'image',onUse:callback};
 window.addEventListener('open-external-connections',event,{once:true});requestConnectionSetup(request);
 expect(event.mock.calls[0][0].detail).toBe(request);expect(callback).not.toHaveBeenCalled();
});
it('refreshes the exact selected connection version and model without generating',async()=>{
 directory();const refresh=vi.fn();window.addEventListener('loop-production-catalog-changed',refresh,{once:true});
 const result=await readConfiguredService('image',{connectionId:'connection',versionId:'version',modelId:'gpt-image-2'});
 expect(result.selection).toEqual({capability:'image',provider:'openai',adapter:'openai_images',connectionVersionId:'version',model:'gpt-image-2'});
 expect(refresh).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/local/connections',undefined);
});
it.each([{versionId:'old',modelId:'gpt-image-2'},{versionId:'version',modelId:'missing'},{versionId:'version'}])('rejects changed choices rather than selecting another service',async choice=>{
 directory();await expect(readConfiguredService('image',{connectionId:'connection',...choice})).rejects.toThrow('已变化');
});
it('permits a material search service without selecting any model',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({serviceCatalog:{groups:[{capability:'video',services:[{...service,mode:'search',provider:'pexels',adapter:'pexels_video',models:[]}]}]}})));
 expect((await readConfiguredService('video',{connectionId:'connection',versionId:'version'})).selection.model).toBeUndefined();
});
