import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RuntimeLogsDialog} from './RuntimeLogsDialog';
import {setUiLocale,useUiLocale} from '../i18n/ui';
afterEach(()=>{cleanup();setUiLocale('zh-CN');vi.unstubAllGlobals();});
it('switches product labels and date format while preserving production names and raw log content',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({observedAt:'2026-11-11T09:00:00Z',sourceAvailable:true,truncated:false,maxEntries:200,entries:[{id:'synthetic-log',level:'INFO',occurredAt:'2026-11-11T09:00:00Z',time:null,episodeId:'synthetic-episode',episodeName:'用户作品名称',operationId:'synthetic-operation',requestId:'synthetic-request',source:'原始来源',message:'原始消息',raw:'中文原始日志',sourceFile:'synthetic.log',line:1,explanation:{what:'原始消息',result:'本条记录的原文'}}]})));
 function Host(){useUiLocale();return <RuntimeLogsDialog onClose={()=>{}} returnFocusRef={{current:null}}/>;}
 render(<Host/>);await screen.findByRole('button',{name:'原始消息'});expect(screen.getByRole('heading',{name:'日志'})).toBeTruthy();
 act(()=>setUiLocale('en-US'));expect(screen.getByRole('heading',{name:'Logs'})).toBeTruthy();expect(screen.getByRole('checkbox',{name:'Errors only'})).toBeTruthy();expect(screen.getByRole('combobox',{name:'Production order'})).toBeTruthy();expect(screen.getByText('用户作品名称',{selector:'td'})).toBeTruthy();expect(screen.getByRole('cell',{name:/11\/11\/26,/})).toBeTruthy();
});
