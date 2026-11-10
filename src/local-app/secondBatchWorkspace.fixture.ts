import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {inspectMediaRoot} from './mediaRootSettings';
/** Match the committed temporary root's actual mount while leaving provider execution unavailable. */
export async function secondBatchWorkspaceFixture(){
 const runtime={mountPath:'',wake(){}};
 return productionWorkspaceFixture({runtime,onSetup:async point=>{if(point.stage==='directory'&&point.root)runtime.mountPath=(await inspectMediaRoot(point.root)).mountPath;}});
}
