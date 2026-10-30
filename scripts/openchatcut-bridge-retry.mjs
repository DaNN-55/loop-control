/** A displaced editor must not automatically take the project back from its new owner. */
export function editorBridgeShouldRetry(error,signal){
 if(signal.aborted)return false;
 return !(error?.name==='EditorBridgeRequestError'&&(error.status===401||error.status===409));
}
/** Applied by the embedded Vite adapter; the installed Studio checkout stays untouched. */
export function patchEditorBridgeRetry(code){
 const start=code.indexOf('async function runBridgeAttempt('),end=code.indexOf('\nasync function runBridge(',start);
 const signature='): Promise<void> {';
 const ownership='  let ownership: BrowserProjectOwnership | undefined;';
 const install='    installBrowserProjectOwnership(ownership);';
 const failure='  } catch (error) {\n    handleExternalBridgeAttemptError(error, signal, onError);';
 const cleanup='    if (ownership) clearBrowserProjectOwnership(ownership);\n  }\n}';
 const loop='    await runBridgeAttempt(projectId, editorInstanceId, runtime, signal, onError);';
 let attempt=start<0||end<0?'':code.slice(start,end);
 if(![signature,ownership,install,failure,cleanup].every(anchor=>attempt.includes(anchor))||!code.includes(loop))throw Error('当前 Studio 缺少编辑连接重试接点。');
 attempt=attempt.replace(signature,'): Promise<boolean> {')
  .replace(ownership,ownership+'\n  let retry = true;')
  .replace(install,'    if (signal.aborted || controller.signal.aborted) return false;\n'+install)
  .replace(failure,'  } catch (error) {\n    retry = editorBridgeShouldRetry(error, signal);\n    handleExternalBridgeAttemptError(error, signal, onError);')
  .replace(cleanup,'    if (ownership) clearBrowserProjectOwnership(ownership);\n  }\n  return retry;\n}');
 return "import {editorBridgeShouldRetry} from 'virtual:loop-control-bridge-retry';\n"+(code.slice(0,start)+attempt+code.slice(end))
  .replace(loop,'    const retry = await runBridgeAttempt(projectId, editorInstanceId, runtime, signal, onError);\n    if (!retry) break;');
}
