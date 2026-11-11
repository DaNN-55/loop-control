// Temporary visual check of the real component; uses the existing Owner session.
// Does not mutate appearance preferences, log files or business state.
import {createRoot} from 'react-dom/client';
import {RuntimeLogsDialog} from '../../../src/local-app/RuntimeLogsDialog';
import '../../../src/styles.css';
import '../../../src/ui/impeccable/foundation.css';
import '../../../src/ui/impeccable/surface-polish.css';
createRoot(document.getElementById('root')!).render(<div className="dan-ui product-ui" data-theme="dark"><RuntimeLogsDialog onClose={()=>window.close()} returnFocusRef={{current:null}}/></div>);
