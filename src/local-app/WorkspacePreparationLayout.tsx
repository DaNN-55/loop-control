import type {ReactNode} from 'react';

/** Column widths are independent of content and old split preferences. */
export function WorkspacePreparationLayout({children}:{children:ReactNode}){
 return <div className="workspace-preparation-grid is-fixed">{children}</div>;
}
