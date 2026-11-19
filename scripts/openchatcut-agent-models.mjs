/** Reuse the native selector; add only enabled models from the host's connections. */
export function patchAgentModels(code,models){
 if(!models||!Object.keys(models).length)return code;
 const start=code.indexOf('function apiChoices('),end=code.indexOf('\nfunction chooseInitialApiId(',start);
 if(start<0||end<0)throw Error('当前 Studio 版本缺少已验证的模型选择接入点。');
 let part=code.slice(start,end);
 const before='    return [{',after='    return (loopHostModels[preset.id] ?? [model]).map((model) => ({';
 if(!part.includes(before)||!part.includes('    }];'))throw Error('当前 Studio 模型选择结构已变化。');
 part=part.replace(before,after).replace('    }];','    }));').replace('capabilities: modelCapabilities(identity),',"capabilities: modelCapabilities({backend:'api',provider:preset.id,modelId:model}),");
 return `const loopHostModels: Record<string,string[]> = ${JSON.stringify(models)};\n`+code.slice(0,start)+part+code.slice(end);
}
