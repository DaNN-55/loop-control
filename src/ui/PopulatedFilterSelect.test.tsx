import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {PopulatedFilterSelect} from './PopulatedFilterSelect';
const options=[{value:'all',label:'全部'},{value:'active',label:'使用中'},{value:'archived',label:'已归档'}];
it('hides empty filters, restores populated ones and resets a selection that loses its data',()=>{
 const change=vi.fn();
 const {rerender}=render(<PopulatedFilterSelect aria-label="范围" options={options} counts={{active:21}} allValue="all" value="active" onValueChange={change}/>);
 expect(screen.queryByRole('option',{name:'已归档'})).toBeNull();
 rerender(<PopulatedFilterSelect aria-label="范围" options={options} counts={{active:21,archived:1}} allValue="all" value="active" onValueChange={change}/>);
 expect(screen.getByRole('option',{name:'已归档'})).toBeTruthy();
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'archived'}});expect(change).toHaveBeenLastCalledWith('archived');change.mockClear();
 rerender(<PopulatedFilterSelect aria-label="范围" options={options} counts={{}} allValue="all" value="archived" onValueChange={change}/>);
 expect(screen.getAllByRole('option')).toHaveLength(1);expect(change).toHaveBeenCalledExactlyOnceWith('all');
});
it('does not reset from stale counts while a new scope is loading',()=>{
 const change=vi.fn();const {rerender}=render(<PopulatedFilterSelect disabled options={options} counts={{active:1}} allValue="all" value="archived" onValueChange={change}/>);
 expect(change).not.toHaveBeenCalled();
 rerender(<PopulatedFilterSelect options={options} counts={{archived:1}} allValue="all" value="archived" onValueChange={change}/>);expect(change).not.toHaveBeenCalled();
});
