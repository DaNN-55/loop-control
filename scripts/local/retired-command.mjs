// Retired standalone remote commands never infer a cloud configuration.
const command=process.argv[2];
if(!['publish:prepare','publish:register-input','publish:verify'].includes(command))throw Error('Unknown retired command');
console.error(`${command} 的独立远端入口已退出本地版本。请在本地控制台通过 Owner 命令操作交付包；兼容旧部署时须显式使用 npm run legacy:${command}。`);
process.exitCode=1;
