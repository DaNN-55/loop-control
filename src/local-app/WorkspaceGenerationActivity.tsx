import {uiText} from '../i18n/ui';
import type {ReactNode} from 'react';
import {WorkspaceModelLogo} from './WorkspaceModelLogo';
import './workspace-generation-activity.css';

/** Only active requests belong here. Errors and reconciliation retain their existing controls. */
export function WorkspaceGenerationActivity({model,provider,children}:{model?:string;provider?:string;children?:ReactNode}){
 return <div className="workspace-generation-activity"><WorkspaceModelLogo model={model} provider={provider}/>{children??<><span role="status" className="workspace-generation-submitting">{uiText("正在准备生成请求")}</span><span className="workspace-task-ring" aria-hidden="true"/></>}</div>;
}
