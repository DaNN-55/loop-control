import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProductionWorkspacePanel} from '../../../src/local-app/ProductionWorkspacePanel';
import {WorkspaceNavigationContext} from '../../../src/local-app/catalogNavigation';
import type {ProductionStep} from '../../../src/episodes/episodeCatalogTypes';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/configuration.css';
import '../../../src/ui/impeccable/production.css';
import '../../../src/local-app/production-compact.css';
function Fixture(){
 const [step,setStep]=useState<ProductionStep>('editing'),[board,setBoard]=useState('board');
 return <main className="dan-ui product-ui" style={{padding:24}}>
  <button onClick={()=>{setStep('preparation');setBoard('new-board');}}>返回分镜并刷新</button>
  <button onClick={()=>void fetch('/__release-open')}>释放打开回执</button>
  <button onClick={()=>void fetch('/__release-read')}>释放刷新回包</button>
  <WorkspaceNavigationContext.Provider value={{episode:'e',step,tab:'visual',change:patch=>{if(patch.step)setStep(patch.step);}}}>
   <ProductionWorkspacePanel episodeId="e" title="刷新顺序核对" scriptRevisionId="s" boardId={board} materials={[]} command={async(name,data)=>{const response=await fetch('/__command',{method:'POST',body:JSON.stringify({name,data})});return response.json();}} onLegacy={()=>{}}/>
  </WorkspaceNavigationContext.Provider>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
