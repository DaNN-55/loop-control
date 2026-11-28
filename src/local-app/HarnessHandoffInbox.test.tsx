import {cleanup,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {HarnessHandoffInbox,useHarnessHandoffEnabled} from './HarnessHandoffInbox';
import type {LocalCatalog} from './catalog';
import {localRequest} from './client';

vi.mock('./client',()=>({localRequest:vi.fn()}));
const request=vi.mocked(localRequest);
const pkg={handoffId:'p01-001',revision:1,productId:'P01',title:'商品短片',status:'received',message:'等待确认',aspectRatio:'9:16',durationSeconds:8,canAccept:true,digest:'frozen-digest'};
const at='2026-11-28T00:00:00Z';
const accounts:LocalCatalog['accounts']=[{id:'a1',slug:'a1',name:'甲账号',timezone:'UTC',current_blueprint_version_id:'bp',created_at:at,archived_at:null}];
const series=[{id:'s1',account_id:'a1',name:'日常'}] as LocalCatalog['series'];
const seriesVersions=[{id:'v2',account_id:'a1',series_id:'s1',version:2},{id:'v1',account_id:'a1',series_id:'s1',version:1}] as LocalCatalog['seriesVersions'];
const open=vi.fn(),close=vi.fn();
function mount(){render(<HarnessHandoffInbox accounts={accounts} series={series} seriesVersions={seriesVersions} onOpenEpisode={open} onClose={close}/>);}
beforeEach(()=>{
 Object.defineProperties(HTMLDialogElement.prototype,{
  showModal:{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}},
  close:{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}},
 });
});
afterEach(()=>{cleanup();Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');request.mockReset();open.mockReset();close.mockReset();});

it('does not show the optional entry until authenticated and positively enabled',async()=>{
 function Entry({owner}:{owner:string}){return useHarnessHandoffEnabled(owner)?<span>entry</span>:null;}
 request.mockResolvedValueOnce({enabled:false,items:[]}).mockResolvedValueOnce({enabled:true,items:[]});
 const {rerender}=render(<Entry owner=""/>);
 expect(request).not.toHaveBeenCalled();
 rerender(<Entry owner="first"/>);
 await waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
 expect(screen.queryByText('entry')).toBeNull();
 rerender(<Entry owner="second"/>);
 expect(await screen.findByText('entry')).toBeTruthy();
 rerender(<Entry owner=""/>);
 expect(screen.queryByText('entry')).toBeNull();
});

it('shows frozen v3 settings and sends them only as the reviewed digest on explicit acceptance',async()=>{
 request.mockResolvedValueOnce({enabled:true,items:[pkg]}).mockResolvedValueOnce({episodeId:'episode-1'});
 mount();const user=userEvent.setup();
 const form=within(await screen.findByRole('form',{name:'商品短片'}));
 expect(screen.getByText('9:16')).toBeTruthy();expect(screen.getByText('8 秒')).toBeTruthy();
 const submit=form.getByRole('button',{name:'确认接单并建单'});
 await user.click(submit);
 expect(request).toHaveBeenCalledTimes(1);
 await user.selectOptions(form.getByLabelText('账号（必选）'),'a1');
 const choice=form.getByLabelText('系列版本');
 expect(within(choice).queryByRole('option',{name:/v1/})).toBeNull();
 await user.selectOptions(choice,'v2');
 expect(request).toHaveBeenCalledTimes(1);
 await user.click(submit);
 const [endpoint,init]=request.mock.calls[1]!;
 expect(endpoint).toBe('harness-handoff');expect(init?.method).toBe('POST');
 expect(JSON.parse(String(init?.body))).toEqual({handoffId:'p01-001',revision:1,accountId:'a1',seriesVersionId:'v2',expectedDigest:'frozen-digest'});
 expect(open).toHaveBeenCalledWith('episode-1',true);
});

it('requires a refresh after an unsuccessful pending attempt and opens only the recovered order',async()=>{
 const pending={...pkg,status:'needs_attention',accountId:'a1',seriesVersionId:'v1',aspectRatio:null,durationSeconds:null};
 request.mockResolvedValueOnce({enabled:true,items:[pending]}).mockRejectedValueOnce(Error('响应丢失')).mockResolvedValueOnce({enabled:true,items:[{...pkg,episodeId:'existing-order',canAccept:false}]});
 mount();const user=userEvent.setup();
 const resume=await screen.findByRole('button',{name:'继续接单'});
 expect(screen.getAllByText('沿用生产默认')).toHaveLength(2);
 expect(screen.queryByRole('combobox')).toBeNull();
 await user.click(resume);
 expect((await screen.findByRole('alert')).textContent).toContain('响应丢失');
 await user.click(resume);
 expect(request).toHaveBeenCalledTimes(2);
 expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toMatchObject({accountId:'a1',seriesVersionId:'v1'});
 await user.click(screen.getByRole('button',{name:'刷新'}));
 await user.click(await screen.findByRole('button',{name:'打开生产单'}));
 expect(open).toHaveBeenCalledWith('existing-order',false);
});
