import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceSpeechSample} from './WorkspaceSpeechSample';
const selection={capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0',connectionVersionId:'voice-connection'} as const;
const props={label:'当前',selection,rate:1,disabled:false};
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('requests the current voice after a selection change instead of replaying the cached previous voice',async()=>{
 const voices:string[]=[],played:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(path.endsWith('/session'))return Response.json({csrfToken:'test-csrf'});const body=JSON.parse(String(init?.body));voices.push(body.voice);return Response.json({audioBase64:body.voice==='voice-A'?'dm9pY2UtQQ==':'dm9pY2UtQg=='});}));
 vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLMediaElement){played.push(this.src);return Promise.resolve();});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 const view=render(<WorkspaceSpeechSample {...props} voice="voice-A"/>);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await waitFor(()=>expect(played).toHaveLength(1));
 view.rerender(<WorkspaceSpeechSample {...props} voice="voice-B"/>);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await waitFor(()=>expect(played).toHaveLength(2));expect(voices).toEqual(['voice-A','voice-B']);expect(played[1]).toBe('data:audio/mpeg;base64,dm9pY2UtQg==');
});
it('does not let a late previous voice response play or unlock the current voice request',async()=>{
 const requests:Array<{voice:string;signal:AbortSignal|null|undefined;finish:(response:Response)=>void}>=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>path.endsWith('/session')?Response.json({csrfToken:'test-csrf'}):new Promise<Response>(finish=>{requests.push({voice:JSON.parse(String(init?.body)).voice,signal:init?.signal,finish});})));
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 const view=render(<WorkspaceSpeechSample {...props} voice="voice-A"/>);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await waitFor(()=>expect(requests).toHaveLength(1));
 view.rerender(<WorkspaceSpeechSample {...props} voice="voice-B"/>);expect(requests[0].signal?.aborted).toBe(true);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await waitFor(()=>expect(requests).toHaveLength(2));
 await act(async()=>requests[0].finish(Response.json({audioBase64:'dm9pY2UtQQ=='})));expect(play).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'试听当前音色'})).toHaveProperty('disabled',true);
 await act(async()=>requests[1].finish(Response.json({audioBase64:'dm9pY2UtQg=='})));expect(play).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'试听当前音色'})).toHaveProperty('disabled',false);
});
it('isolates A to B to A visits, including old errors and completion',async()=>{
 const requests:Array<{finish:(response:Response)=>void;fail:(error:Error)=>void}>=[];vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.endsWith('/session')?Response.json({csrfToken:'test-csrf'}):new Promise<Response>((finish,fail)=>requests.push({finish,fail}))));
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});const view=render(<WorkspaceSpeechSample {...props} voice="voice-A"/>);
 for(const [index,voice] of ['voice-A','voice-B','voice-A'].entries()){view.rerender(<WorkspaceSpeechSample {...props} voice={voice}/>);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await waitFor(()=>expect(requests).toHaveLength(index+1));}
 await act(async()=>{requests[0].finish(Response.json({audioBase64:'b2xk'}));requests[1].fail(Error('旧音色失败'));});expect(play).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('button',{name:'试听当前音色'})).toHaveProperty('disabled',true);
 await act(async()=>requests[2].finish(Response.json({audioBase64:'bmV3'})));expect(play).toHaveBeenCalledOnce();
});
it.each([{model:'another-model'},{connectionVersionId:'another-connection'}])('does not reuse a player across a source selection change %j',async patch=>{
 const bodies:Array<{selection:Record<string,string>}> =[];vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(path.endsWith('/session'))return Response.json({csrfToken:'test-csrf'});bodies.push(JSON.parse(String(init?.body)));return Response.json({audioBase64:'c2FtcGxl'});}));
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});const view=render(<WorkspaceSpeechSample {...props} voice="voice-A"/>);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await waitFor(()=>expect(play).toHaveBeenCalledOnce());
 view.rerender(<WorkspaceSpeechSample {...props} voice="voice-A" selection={{...selection,...patch}}/>);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await waitFor(()=>expect(play).toHaveBeenCalledTimes(2));expect(bodies).toHaveLength(2);expect(bodies[1].selection).toEqual({...selection,...patch});
});
it('keeps each first synthesis explicitly confirmed and ignores an old synthesis reply',async()=>{
 const bodies:Array<{voice:string;generate:boolean}>=[];let old!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{if(path.endsWith('/session'))return Response.json({csrfToken:'test-csrf'});const body=JSON.parse(String(init?.body));bodies.push(body);return body.generate?new Promise<Response>(resolve=>{old=resolve;}):Response.json({audioBase64:null});}));
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});const view=render(<WorkspaceSpeechSample {...props} voice="voice-A"/>);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await screen.findByRole('dialog',{name:'准备音色样音'});fireEvent.click(screen.getByRole('button',{name:'确认合成并试听'}));await waitFor(()=>expect(bodies).toHaveLength(2));
 view.rerender(<WorkspaceSpeechSample {...props} voice="voice-B"/>);expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await screen.findByRole('dialog',{name:'准备音色样音'});await act(async()=>old(Response.json({audioBase64:'b2xk'})));
 expect(play).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'确认合成并试听'})).toHaveProperty('disabled',false);expect(bodies.map(({voice,generate})=>({voice,generate}))).toEqual([{voice:'voice-A',generate:false},{voice:'voice-A',generate:true},{voice:'voice-B',generate:false}]);
});
it('ends client waiting on unmount without playing a late sample response',async()=>{
 let finish!:(response:Response)=>void,signal:AbortSignal|null|undefined;vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>path.endsWith('/session')?Response.json({csrfToken:'test-csrf'}):new Promise<Response>(resolve=>{finish=resolve;signal=init?.signal;})));
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});const view=render(<WorkspaceSpeechSample {...props} voice="voice-A"/>);fireEvent.click(screen.getByRole('button',{name:'试听当前音色'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));view.unmount();expect(signal?.aborted).toBe(true);await act(async()=>finish(Response.json({audioBase64:'bGF0ZQ=='})));expect(play).not.toHaveBeenCalled();
});
