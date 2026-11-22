import {expect,it} from 'vitest';
import {productionCatalogParameters} from './productionCatalogPreview';

it('does not present original settings as current video metadata',()=>{
 expect(productionCatalogParameters('## 制作设置\n- 画幅：9:16\n- 字幕：开启')).toEqual([
  {label:'画幅',value:'9:16（原稿）'},{label:'时长',value:'视频加载后显示'},{label:'字幕',value:'未确认'},
 ]);
});
it('uses loaded video dimensions and duration, and current workspace captions',()=>{
 expect(productionCatalogParameters('## 制作设置\n- 画幅：9:16',{width:1920,height:1080,duration:12.4},[{contract:{enabled:false}}])).toEqual([
  {label:'画幅',value:'16:9'},{label:'时长',value:'12.4 秒'},{label:'字幕',value:'关闭'},
 ]);
});
it('keeps missing data honest and distinguishes mixed captions',()=>{
 expect(productionCatalogParameters('',{width:0,height:0,duration:Infinity},[{contract:{enabled:true}},{contract:{enabled:false}}])).toEqual([
  {label:'画幅',value:'未确认'},{label:'时长',value:'视频加载后显示'},{label:'字幕',value:'部分开启'},
 ]);
});
