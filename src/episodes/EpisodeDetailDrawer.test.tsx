import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {EpisodeDetailDrawer} from './EpisodeDetailDrawer';
afterEach(cleanup);
it('点击抽屉外遮罩或按 Escape 可以关闭生产单详情',async()=>{
 const user=userEvent.setup(),onClose=vi.fn();render(<EpisodeDetailDrawer isOpen onClose={onClose}><p>详情内容</p></EpisodeDetailDrawer>);
 await user.click(screen.getByTestId('episode-detail-scrim'));expect(onClose).toHaveBeenCalledTimes(1);await user.keyboard('{Escape}');expect(onClose).toHaveBeenCalledTimes(2);
});
it('放大预览打开时按 Escape 不关闭生产单详情',async()=>{
 const user=userEvent.setup(),onClose=vi.fn();render(<EpisodeDetailDrawer isOpen onClose={onClose}><div aria-modal="true" role="dialog">放大预览</div></EpisodeDetailDrawer>);
 await user.keyboard('{Escape}');expect(onClose).not.toHaveBeenCalled();
});
