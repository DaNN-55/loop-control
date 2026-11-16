import {createContext,useContext,type ComponentProps,type RefObject} from 'react';
import {Popover} from 'react-aria-components';

export const WorkspacePopoverContainer=createContext<RefObject<HTMLElement|null>|null>(null);

/** Native modal descendants must stay in its top layer, including nested pickers. */
export function WorkspacePopover(props:ComponentProps<typeof Popover>){
 const container=useContext(WorkspacePopoverContainer);
 return <Popover {...props} UNSTABLE_portalContainer={container?.current??props.UNSTABLE_portalContainer}/>;
}
