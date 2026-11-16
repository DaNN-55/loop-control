import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {EpisodeDetailDrawer} from '../episodes/EpisodeDetailDrawer';
import {CompletedDialog} from './CompletedDialog';
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;fireEvent(this,new Event('close'));}});
});
afterEach(cleanup);
function Nested(){const [parent,setParent]=useState(true),[child,setChild]=useState(true);return <CompletedDialog open={parent} title="镜头详情" onClose={()=>setParent(false)}><p>保留当前镜头</p><CompletedDialog open={child} title="参数详情" onClose={()=>setChild(false)}><p>参数正文</p></CompletedDialog></CompletedDialog>;}
it('closes only the invoked child dialog and keeps the parent context open',()=>{
 render(<Nested/>);fireEvent.click(within(screen.getByRole('dialog',{name:'参数详情'})).getByRole('button',{name:'关闭详情'}));
 expect(screen.queryByRole('dialog',{name:'参数详情'})).toBeNull();expect(screen.getByRole('dialog',{name:'镜头详情'})).toBeTruthy();expect(screen.getByText('保留当前镜头')).toBeTruthy();
});

it('leaves the outer episode open when Escape is handled by the native shot dialog',()=>{
 const closeEpisode=vi.fn();
 function Episode(){return <EpisodeDetailDrawer isOpen onClose={closeEpisode}><CompletedDialog open title="镜头详情" onClose={()=>{}}><p>镜头正文</p></CompletedDialog></EpisodeDetailDrawer>;}
 render(<Episode/>);
 const close=within(screen.getByRole('dialog',{name:'镜头详情'})).getByRole('button',{name:'关闭详情'});close.focus();
 fireEvent.keyDown(close,{key:'Escape'});
 expect(closeEpisode).not.toHaveBeenCalled();
});
