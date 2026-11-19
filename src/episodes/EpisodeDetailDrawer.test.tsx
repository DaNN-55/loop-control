import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {EpisodeDetailDrawer} from './EpisodeDetailDrawer';
afterEach(cleanup);
it('moves focus into production after the settings overlay releases it',()=>{
 const close=vi.fn();const app=render(<><button>系统状态</button><EpisodeDetailDrawer isOpen inert onClose={close}><p>生产内容</p></EpisodeDetailDrawer></>);
 screen.getByRole('button',{name:'系统状态'}).focus();
 app.rerender(<><button>系统状态</button><EpisodeDetailDrawer isOpen inert={false} onClose={close}><p>生产内容</p></EpisodeDetailDrawer></>);
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'返回工作区'}));
});
it('点击抽屉外遮罩或按 Escape 可以关闭生产单详情',async()=>{
 const user=userEvent.setup(),onClose=vi.fn();render(<EpisodeDetailDrawer isOpen onClose={onClose}><p>详情内容</p></EpisodeDetailDrawer>);
 await user.click(screen.getByTestId('episode-detail-scrim'));expect(onClose).toHaveBeenCalledTimes(1);await user.keyboard('{Escape}');expect(onClose).toHaveBeenCalledTimes(2);
});
it('放大预览打开时按 Escape 不关闭生产单详情',async()=>{
 const user=userEvent.setup(),onClose=vi.fn();render(<EpisodeDetailDrawer isOpen onClose={onClose}><div aria-modal="true" role="dialog">放大预览</div></EpisodeDetailDrawer>);
 await user.keyboard('{Escape}');expect(onClose).not.toHaveBeenCalled();
});
it('原生核对弹窗打开时 Escape 只交给内层，不退出生产单',async()=>{
 const user=userEvent.setup(),onClose=vi.fn();render(<EpisodeDetailDrawer isOpen onClose={onClose}><dialog open aria-label="素材预览"><button>下一条</button></dialog></EpisodeDetailDrawer>);
 screen.getByRole('button',{name:'下一条'}).focus();await user.keyboard('{Escape}');expect(onClose).not.toHaveBeenCalled();
});
