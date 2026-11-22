import {useRef,useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {MediaRangeEditor} from './MediaRangeEditor';
afterEach(cleanup);
it('uses keyboard range handles, reveals precision beside reset and restores the whole source',async()=>{
 const changed=vi.fn();function Fixture(){const [range,setRange]=useState<[number,number]>([1,4]);return <MediaRangeEditor label="视频" duration={6} value={range} step={.1} onChange={v=>{changed(v);setRange(v);}}/>;}
 render(<Fixture/>);const user=userEvent.setup();
 expect(screen.queryAllByRole('slider')).toHaveLength(0);expect(screen.queryByRole('button',{name:'精确时间'})).toBeNull();await user.click(screen.getByRole('button',{name:'裁剪'}));
 const precision=screen.getByRole('button',{name:'精确时间'}),reset=screen.getByRole('button',{name:'重置'});expect(precision.compareDocumentPosition(reset)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.queryByRole('spinbutton')).toBeNull();await user.click(precision);
 fireEvent.change(screen.getByRole('spinbutton',{name:'视频使用起点（秒）'}),{target:{value:'2'}});expect(changed).toHaveBeenLastCalledWith([2,4]);
 const start=screen.getByRole('slider',{name:/视频选区起点/});start.focus();await user.keyboard('{ArrowRight}');expect(changed).toHaveBeenLastCalledWith([2.1,4]);
 await user.click(reset);expect(changed).toHaveBeenLastCalledWith([0,6]);await user.click(screen.getByRole('button',{name:'裁剪'}));expect(screen.queryAllByRole('slider')).toHaveLength(0);await user.click(screen.getByRole('button',{name:'裁剪'}));expect(screen.getByRole('slider',{name:/视频选区终点/})).toHaveProperty('value','6');
});
it('rejects an inverted precision window without seeking or changing the source',()=>{
 const changed=vi.fn();function Fixture(){return <MediaRangeEditor label="音频" duration={6} value={[1,4]} media={useRef(null)} onChange={changed} preciseOpen/>;}
 render(<Fixture/>);fireEvent.change(screen.getByRole('spinbutton',{name:'音频使用终点（秒）'}),{target:{value:'.5'}});expect(changed).not.toHaveBeenCalled();
});
