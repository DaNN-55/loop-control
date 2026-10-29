import {it,expect,vi} from 'vitest';
import {viewTransport} from './viewTransport';
it('missing shared-view callbacks fail before any network request',()=>{const request=vi.spyOn(globalThis,'fetch');try{for(const operation of [()=>viewTransport.auth,()=>viewTransport.from('accounts'),()=>viewTransport.rpc('read_episode_catalog')])expect(operation).toThrow('已退役');expect(request).not.toHaveBeenCalled();}finally{request.mockRestore();}});
