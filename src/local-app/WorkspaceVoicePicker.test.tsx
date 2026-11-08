import {useState} from 'react';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceVoicePicker} from './WorkspaceVoicePicker';
const voices=['zh_female_vv_uranus_bigtts','zh_male_m191_uranus_bigtts','zh_female_xiaohe_uranus_bigtts'];
afterEach(cleanup);
function setup(initial=voices[0],disabled=false){const changed=vi.fn();function Field(){const [value,setValue]=useState(initial);return <WorkspaceVoicePicker value={value} onChange={next=>{setValue(next);changed(next);}} voices={voices} provider="volcengine_tts" label="音色" disabled={disabled}/>;}render(<Field/>);return changed;}
it('shows the name, searches Chinese and submits only the original voice ID',async()=>{
 const user=userEvent.setup(),changed=setup();const input=screen.getByRole('combobox',{name:'音色'});expect(input).toHaveProperty('value','Vivi 2.0 · 多语种女声');await user.clear(input);await user.type(input,'云舟');expect(await screen.findByRole('option',{name:/云舟 2.0/})).toBeTruthy();expect(screen.queryByRole('option',{name:/小何/})).toBeNull();expect(changed).not.toHaveBeenCalled();await user.click(screen.getByRole('option',{name:/云舟 2.0/}));expect(changed).toHaveBeenCalledExactlyOnceWith(voices[1]);expect(input).toHaveProperty('value','云舟 2.0');
});
it('searches by ID, supports keyboard selection and restores the selected name after Escape',async()=>{
 const user=userEvent.setup(),changed=setup(),input=screen.getByRole('combobox');await user.clear(input);await user.type(input,'xiaohe');expect(await screen.findByRole('option',{name:/小何/})).toBeTruthy();await user.keyboard('{ArrowDown}{Enter}');expect(changed).toHaveBeenCalledWith(voices[2]);await user.clear(input);await user.type(input,'no-match');expect(await screen.findByText('没有匹配的音色')).toBeTruthy();await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('listbox')).toBeNull());expect(input).toHaveProperty('value','小何 2.0');expect(changed).toHaveBeenCalledTimes(1);
});
it('keeps an unknown saved ID until the user explicitly chooses a supported voice',async()=>{
 const user=userEvent.setup(),changed=setup('legacy-custom-voice');await user.click(screen.getByRole('button',{name:'音色选项'}));expect(await screen.findByRole('option',{name:/云舟/})).toBeTruthy();await user.keyboard('{Escape}');expect(screen.getByRole('combobox')).toHaveProperty('value','legacy-custom-voice');expect(changed).not.toHaveBeenCalled();
});
it('disables the search and dropdown together',()=>{setup(voices[0],true);expect(screen.getByRole('combobox')).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'音色选项'})).toHaveProperty('disabled',true);});
