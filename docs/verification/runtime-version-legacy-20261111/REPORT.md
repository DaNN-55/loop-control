# 补测旧版运行时兼容分支

2026-11-11。用户要求补测上轮默认套件中唯一跳过项，并确认默认套件没有剩余失败或跳过。

## 原因

原跳过项在`src/local-app/runtimeVersion.test.ts`：`legacy runtime APIs remain unverified instead of borrowing the prepared version`。

原文件按`readPreparedRuntimeRelease`导出是否存在，互斥运行新版或旧版测试。当前代码已导出该API，因此旧版测试每次都会被`skipIf`跳过。这是旧兼容期留下的测试条件，不是该分支已经被执行通过，也与机器上是否已经准备编译产物无关。

## 修改

- 新版9项直接调用实际API，每次执行；移除动态探测和条件跳过。
- 旧版分支移到独立模块测试，在该测试的隔离依赖中显式缺失版本识别API。
- 先使用真实准备/校验函数在临时目录生成有效版本，再检查旧环境中的读取结果仍为unknown且3个版本ID均为null，不能冒用旁边的新版本。临时文件由测试清理。
- 业务代码、部署、真实数据和密钥未修改，无需重载服务。

## 额外发现的间歇性测试失败

首次完整回归中`LocalCatalogApp.receipts.test.tsx`一项失败。创建弹窗实际上已关闭；失败发生在随后同步`getByRole('alert')`。页面切换可能发起新的目录读取，原有过期读取被正常忽略，测试却过早查找当前有效读取的错误提示。单文件6项及定向重复10次均通过，完整回归保留了失败证据：`default-tests.log`。

修正只涉及测试：确认弹窗在目录读取尚挂起时已关闭；让已有及后续读取均返回受控503；等待有效提示实际出现，并验证创建POST只有1次。不增加任意延时、不调整业务代码、不跳过断言。

## 已执行

- `targeted.log`：新版9项+旧版1项，10通过，0跳过。
- `targeted-final.log`：回执6项+运行时10项，16通过，0跳过。
- `typecheck.log`：`npm run check`通过。
- `default-tests-final.log`：最终完整默认套件290个文件、2104项全部通过，0失败、0跳过，用时242.23秒。首次2103通过/1失败/0跳过的过程保留在`default-tests.log`，不作为最终全绿证据。

默认套件命令为`npm test -- --maxWorkers=1 --fileParallelism=false`，按项目既有配置排除需显式开启的`*.integration.test.ts`，本轮不宣称重新运行全部门控集成。原48类业务验证不受仅测试文件修改影响。
