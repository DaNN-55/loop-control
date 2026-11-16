import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CompletedProductionRecords} from './CompletedProductionRecords';
import type {ProductionWorkspace} from '../productionWorkspace';
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;fireEvent(this,new Event('close'));}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('keeps original script, production input and submitted prompt distinct when the candidate script field is empty',()=>{
 const w={clips:[{shotId:'S1',itemId:'a'}],visualCandidates:[{id:'old',kind:'video',shotId:'S1',targetItemId:'a',mainScriptText:'',status:'available',relativePath:'old.mp4',sha256:'sha',generation:{prompt:'人工制作输入',actualPrompt:'Submitted prompt plus rules'}}]} as unknown as ProductionWorkspace;
 render(<CompletedProductionRecords workspace={w} project={null} shotId="S1" section="visual" originalScript="中文原脚本画面意图"/>);
 fireEvent.click(screen.getByRole('button',{name:'展开未采用视频 1'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'原脚本'}));expect(screen.getByText('中文原脚本画面意图')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'制作输入'}));expect(screen.getByText('人工制作输入')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'实际提交'}));expect(screen.getByText('Submitted prompt plus rules')).toBeTruthy();
});

it('filters unused records in place by type and status, retaining failed requests and resetting the expanded candidate',()=>{
 const w={clips:[{shotId:'S1',itemId:'a'}],visualCandidates:[
  {id:'video',kind:'video',shotId:'S1',targetItemId:'a',status:'available',relativePath:'old.mp4',sha256:'sha'},
  {id:'image',kind:'image',shotId:'S1',targetItemId:'a',status:'rejected',relativePath:'old.png',sha256:'sha'},
 ],visualTasks:[{id:'failed',taskId:'failed',shotId:'S1',kind:'video',status:'failed',error:'供应商请求失败'}]} as unknown as ProductionWorkspace;
 render(<CompletedProductionRecords workspace={w} project={null} shotId="S1" section="visual"/>);
 const unused=within(screen.getByRole('region',{name:'未采用'}));
 // Native select menus remain interactive inside a native modal dialog.
 expect(fireEvent.mouseDown(unused.getByRole('combobox',{name:'记录类型'}),{button:0})).toBe(true);
 expect(unused.getAllByRole('button',{name:/展开未采用/})).toHaveLength(3);
 fireEvent.click(unused.getByRole('button',{name:'展开未采用图片 2'}));
 expect(unused.getByRole('img',{name:'候选图片'})).toBeTruthy();
 fireEvent.change(unused.getByRole('combobox',{name:'记录类型'}),{target:{value:'request'}});
 expect(unused.queryByRole('img',{name:'候选图片'})).toBeNull();
 fireEvent.click(unused.getByRole('button',{name:'展开未采用视频请求 1'}));
 expect(unused.getByText('供应商请求失败')).toBeTruthy();
 fireEvent.change(unused.getByRole('combobox',{name:'记录状态'}),{target:{value:'rejected'}});
 expect(unused.getByText('没有符合筛选的记录。')).toBeTruthy();
 fireEvent.change(unused.getByRole('combobox',{name:'记录类型'}),{target:{value:'all'}});
 expect(unused.getByRole('button',{name:'展开未采用图片 1'})).toBeTruthy();
 expect(screen.queryByRole('dialog')).toBeNull();
});
