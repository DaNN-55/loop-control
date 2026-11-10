import {useState} from 'react';
import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkspacePromptField} from './WorkspacePromptField';
afterEach(cleanup);
const mentions=[{token:'@图片1',materialRevisionId:'a',kind:'image' as const,name:'人物.png'},{token:'@视频1',materialRevisionId:'v',kind:'video' as const,name:'动作.mp4'}];
function Field(){const [text,setText]=useState('');return <WorkspacePromptField label="提示词" ariaLabel="提示词" value={text} limit={1200} onChange={setText} mentions={mentions}/>;}
it('inserts a reference at the caret using keyboard selection and preserves following text',async()=>{
 render(<Field/>);const input=screen.getByRole('textbox',{name:'提示词'});
 await userEvent.type(input,'让@');expect(screen.getAllByRole('option')).toHaveLength(2);
 await userEvent.keyboard('{ArrowDown}{Enter}');expect(input).toHaveProperty('value','让@视频1 ');expect(screen.queryByRole('listbox')).toBeNull();
 await userEvent.type(input,'运动');(input as HTMLTextAreaElement).setSelectionRange(1,1);
 await userEvent.click(screen.getByRole('button',{name:'插入参考素材'}));await userEvent.click(screen.getByRole('option',{name:/图片1/}));
 expect(input).toHaveProperty('value','让@图片1 @视频1 运动');
});
it('filters names, closes with Escape and keeps IME Enter for text composition',async()=>{
 render(<Field/>);const input=screen.getByRole('textbox',{name:'提示词'});
 await userEvent.type(input,'@人物');expect(screen.getAllByRole('option')).toHaveLength(1);
 fireEvent.keyDown(input,{key:'Enter',isComposing:true});expect(input).toHaveProperty('value','@人物');
 await userEvent.keyboard('{Escape}');expect(screen.queryByRole('listbox')).toBeNull();
});
