import {uiText} from '../i18n/ui';
import {useContext,useState} from 'react';
import {Check,ChevronDown,Volume2} from 'lucide-react';
import {Button,ComboBox,ComboBoxStateContext,Input,ListBox,ListBoxItem,Popover} from 'react-aria-components';
import '../ui/dan-ui/components/base/select/icon-combobox.css';
import '../ui/dan-ui/components/base/select/select-menu.css';

// Display aliases for the registered catalogue; the provider ID remains the value.
// Naming reference: https://docs.volcengine.com/docs/doubao-voice/tone-list-3?lang=zh
const volcengineVoiceNames:Readonly<Record<string,string>>={
 get zh_female_vv_uranus_bigtts(){return uiText("Vivi 2.0 · 多语种女声");},
 get zh_male_m191_uranus_bigtts(){return uiText("云舟 2.0");},
 get zh_male_taocheng_uranus_bigtts(){return uiText("小天 2.0");},
 get zh_female_xiaohe_uranus_bigtts(){return uiText("小何 2.0");},
 get zh_female_qingxinnvsheng_uranus_bigtts(){return uiText("清新女声 2.0");},
 get zh_male_huolixiaoge_uranus_bigtts(){return uiText("活力小哥 2.0");},
 get zh_male_baqiqingshu_uranus_bigtts(){return uiText("霸气青叔 2.0");},
 get zh_female_mizai_uranus_bigtts(){return uiText("黑猫侦探社咪仔 2.0");},
 get ICL_uranus_zh_male_paoxiaoxiaoge_tob(){return uiText("咆哮小哥 2.0");},
 get zh_male_xionger_uranus_bigtts(){return uiText("熊二 2.0");},
};
export function speechVoiceName(provider:string|undefined,voice:string){return provider==='volcengine_tts'?volcengineVoiceNames[voice]??voice:voice;}

export function WorkspaceVoicePicker({value,onChange,voices,provider,label,id,disabled}:{value:string;onChange:(voice:string)=>void;voices:string[];provider?:string;label:string;id?:string;disabled?:boolean}){
 const [query,setQuery]=useState<string|null>(null);
 const items=voices.map(voice=>({id:voice,name:speechVoiceName(provider,voice)}));
 const search=query?.trim().toLocaleLowerCase()??'';
 const filtered=search?items.filter(item=>`${item.name} ${item.id}`.toLocaleLowerCase().includes(search)):items;
 return <ComboBox aria-label={label} menuTrigger="manual" className="dan-ui dan-icon-combobox workspace-voice-picker" items={filtered}
  selectedKey={voices.includes(value)?value:null} inputValue={query??speechVoiceName(provider,value)}
  onInputChange={setQuery} onSelectionChange={key=>{if(key!=null){if(String(key)!==value)onChange(String(key));setQuery(null);}}}
  onOpenChange={next=>{if(!next)setQuery(null);}} onBlur={()=>setQuery(null)}
  isDisabled={disabled||voices.length===0} allowsEmptyCollection>
  <VoiceControl id={id} label={label} value={value}/>
 </ComboBox>;
}

function VoiceControl({id,label,value}:{id?:string;label:string;value:string}){
 const state=useContext(ComboBoxStateContext);
 return <div className="dan-icon-combobox-control" onKeyDownCapture={event=>{if(event.key==='Escape'&&state?.isOpen){event.preventDefault();event.stopPropagation();state.close();}}}>
   <Volume2 className="dan-icon-combobox-leading" aria-hidden="true"/>
   <Input id={id} onChange={()=>state?.open(null,'manual')} aria-label={label} className="dan-icon-combobox-input" placeholder={uiText("搜索或选择音色")} title={value}/>
   <Button className="dan-icon-combobox-toggle" aria-label={uiText("{value0}选项",{value0:String(label)})}><ChevronDown aria-hidden="true"/></Button>
   <Popover className="dan-ui product-ui dan-select-popover dan-icon-combobox-popover workspace-voice-picker-popover" placement="bottom start" offset={6} containerPadding={12} shouldFlip>
    <ListBox<{id:string;name:string}> aria-label={uiText("可用音色")} className="dan-select-listbox" renderEmptyState={()=><p className="dan-icon-combobox-empty">{uiText("没有匹配的音色")}</p>}>
     {item=><ListBoxItem id={item.id} textValue={item.name} className="dan-select-option"><span className="workspace-voice-option-label">{item.name}<small>{item.id}</small></span><Check className="dan-select-option-check" aria-hidden="true"/></ListBoxItem>}
    </ListBox>
   </Popover>
  </div>;
}
