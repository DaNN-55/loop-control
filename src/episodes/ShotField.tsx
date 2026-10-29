import type {ReactNode} from 'react';
/** A visible prefix inside the control boundary; the label still names the input. */
export function ShotField({label,children}:{label:string;children:ReactNode}){
 return <label className="shot-inline-field"><span className="shot-inline-field-label">{label}</span>{children}</label>;
}
