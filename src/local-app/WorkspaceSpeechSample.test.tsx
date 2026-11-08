import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceSpeechSample} from './WorkspaceSpeechSample';
import {localRequest} from './client';

vi.mock('./client',()=>({localRequest:vi.fn()}));
afterEach(()=>vi.restoreAllMocks());

it('requires confirmation for the first sample and replays it at the current speed',async()=>{
 const request=vi.mocked(localRequest).mockResolvedValueOnce({audioBase64:null}).mockResolvedValueOnce({audioBase64:'YWJj'});
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 const selection={capability:'speech',provider:'volcengine_tts',adapter:'volcengine_tts',model:'seed-tts-2.0'} as const;
 const props={label:'默认',selection,voice:'voice',disabled:false};
 const {container,rerender}=render(<WorkspaceSpeechSample {...props} rate={1.15}/>);
 fireEvent.click(screen.getByRole('button',{name:'试听默认音色'}));
 await screen.findByRole('dialog',{name:'准备音色样音'});
 expect(JSON.parse(String(request.mock.calls[0][1]?.body)).generate).toBe(false);
 expect(play).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'确认合成并试听'}));
 await waitFor(()=>expect(play).toHaveBeenCalledTimes(1));
 const player=container.querySelector('audio')!;
 expect(player.playbackRate).toBe(1.15);
 expect(JSON.parse(String(request.mock.calls[1][1]?.body)).generate).toBe(true);
 rerender(<WorkspaceSpeechSample {...props} rate={0.8}/>);
 fireEvent.click(screen.getByRole('button',{name:'试听默认音色'}));
 await waitFor(()=>expect(play).toHaveBeenCalledTimes(2));
 expect(player.playbackRate).toBe(0.8);
 expect(request).toHaveBeenCalledTimes(2);
});
