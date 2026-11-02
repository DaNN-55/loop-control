import {Dialog,Modal,ModalOverlay} from 'react-aria-components';
import {Button} from '../ui/dan-ui/components/base/buttons/button';

export function ConnectionDraftLeaveDialog({navigation=false,hasSecret=false,onContinue,onDiscard,onKeep}:{navigation?:boolean;hasSecret?:boolean;onContinue:()=>void;onDiscard:()=>void;onKeep?:()=>void}){
 return <ModalOverlay className="product-ui reference-connections-overlay" isOpen isDismissable onOpenChange={open=>{if(!open)onContinue();}}><Modal className="reference-connections-modal"><Dialog aria-label={navigation?'离开前处理修改':'关闭前处理修改'} className="dan-ui connection-workspace reference-connections reference-connections-dialog">
  <header className="reference-connections-dialog-header"><h2>{navigation?'离开前处理修改':'关闭前处理修改'}</h2></header>
  <div className="reference-connections-detail-body"><p>修改尚未保存。</p>{onKeep&&<p>可保留非敏感修改，在本次工作区重新打开时继续编辑。</p>}{hasSecret&&<p>API Key 等认证材料只保留在当前表单；关闭后需要重新填写。</p>}</div>
  <footer className="reference-connections-dialog-footer"><Button color="secondary" size="sm" autoFocus onPress={onContinue}>继续编辑</Button><Button color="secondary-destructive" size="sm" onPress={onDiscard}>{navigation?'放弃修改并离开':'放弃修改并关闭'}</Button>{onKeep&&<Button color="primary" size="sm" onPress={onKeep}>{navigation?'保留修改并离开':'保留修改并关闭'}</Button>}</footer>
 </Dialog></Modal></ModalOverlay>;
}
