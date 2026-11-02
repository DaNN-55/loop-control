import {useEffect,type ComponentProps} from 'react';
import {NativeSelect} from './dan-ui/components/base/select/select-native';

type Props=Omit<ComponentProps<typeof NativeSelect>,'children'|'options'|'value'|'onChange'>&{
 options:{value:string;label:string}[];
 counts:Record<string,number>|undefined;
 allValue:string;
 value:string;
 onValueChange:(value:string)=>void;
};
// Counts describe the whole eligible dataset, before search and pagination.
export function PopulatedFilterSelect({options,counts,allValue,value,onValueChange,...props}:Props){
 const visible=options.filter(option=>option.value===allValue||!counts||(counts[option.value]??0)>0);
 const valid=visible.some(option=>option.value===value);
 useEffect(()=>{if(counts&&!valid&&!props.disabled)onValueChange(allValue);},[counts,valid,props.disabled,allValue,onValueChange]);
 return <NativeSelect {...props} value={valid?value:allValue} options={visible} onChange={event=>onValueChange(event.target.value)}/>;
}
