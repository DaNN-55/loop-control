import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {useDialogFocus} from './useDialogFocus';
afterEach(cleanup);
function Dialog(){const ref=useDialogFocus(true,vi.fn());return <section ref={ref} role="dialog"><button>关闭</button><details><summary>连接版本</summary><button>重新绑定</button></details><div hidden><button>隐藏标签中的按钮</button></div></section>;}
it('wraps focus through visible summaries and skips collapsed details and hidden tab panels',async()=>{
 const user=userEvent.setup();render(<Dialog/>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'关闭'}));
 await user.tab({shift:true});expect(document.activeElement).toBe(screen.getByText('连接版本'));
 await user.tab();expect(document.activeElement).toBe(screen.getByRole('button',{name:'关闭'}));
 await user.click(screen.getByText('连接版本'));await user.tab();expect(document.activeElement).toBe(screen.getByRole('button',{name:'重新绑定'}));
 await user.tab();expect(document.activeElement).toBe(screen.getByRole('button',{name:'关闭'}));
});
