import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {WorkspaceDurationControl,WorkspaceResolutionChoices} from './WorkspaceGenerationChoices';
afterEach(cleanup);
it('maps a discrete duration slider to actual supported values rather than an unsupported integer',()=>{
 const change=vi.fn();render(<WorkspaceDurationControl value="5" min={5} max={10} durations={[5,10]} onChange={change}/>);
 fireEvent.change(screen.getByRole('slider'),{target:{value:'1'}});expect(change).toHaveBeenCalledWith('10');
});
it('keeps the original voice duration and locks both controls',()=>{
 render(<WorkspaceDurationControl value={7.25} min={4} max={15} locked onChange={vi.fn()}/>);
 expect(screen.getByRole('slider')).toHaveProperty('disabled',true);expect(screen.getByRole('spinbutton')).toHaveProperty('readOnly',true);expect(screen.getByRole('spinbutton')).toHaveProperty('value','7.25');
});
it('only offers the supplied resolutions and emits the exact API value',()=>{
 const change=vi.fn();render(<WorkspaceResolutionChoices values={['480P','768P']} value="768P" onChange={change}/>);
 expect(screen.queryByRole('button',{name:'1080P'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'480P'}));expect(change).toHaveBeenCalledWith('480P');
});
