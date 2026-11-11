import {receiptMessages} from './receipts';
import {compactConnections} from './compactConnections';
import {compactSecrets} from './compactSecrets';
import {recycleMessages} from './recycle';
import {dynamicMessages} from './dynamic';
import {visualHelpersMessages} from './visualHelpers';
import {workflowMessages} from './workflow';
import {preferencesMessages} from './preferences';
import {accountsMessages} from './accounts';
import {navigationMessages} from './navigation';
import {navigationExtraMessages} from './navigationExtra';
import {productionMessages} from './production';
import {productionExtraMessages} from './productionExtra';
import {logsMessages} from './logs';
import {systemStatusMessages} from './systemStatus';
import {visualMessages} from './visual';
import {visualExtraMessages} from './visualExtra';
import {connectionsMessages} from './connections';
import {observabilityMessages} from './observability';
export const englishMessages:Record<string,string>={...receiptMessages,...compactSecrets,...recycleMessages,...workflowMessages,...preferencesMessages,...accountsMessages,...navigationMessages,...navigationExtraMessages,...productionMessages,...productionExtraMessages,...logsMessages,...systemStatusMessages,...visualMessages,...visualExtraMessages,...connectionsMessages,...observabilityMessages,...visualHelpersMessages,...dynamicMessages,...compactConnections,
 // Shared terms have one rendering across modules. Identifiers and data remain unchanged.
 "生产单":"Production order","分镜台":"Storyboard","剪辑工作台":"Editing workspace","检查与交付":"Review & delivery","个人偏好":"Preferences","保存中…":"Saving…","读取中…":"Loading…","制作中":"In production","待审核":"Awaiting review","需处理":"Needs attention","已完成":"Completed"
};
