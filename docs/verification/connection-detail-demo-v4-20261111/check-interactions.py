import subprocess,json,pathlib
root=pathlib.Path(__file__).resolve().parent
base='http://127.0.0.1:5210/src/local-app/connection-detail-v4.prototype.html'
steps=[]
def run(*a):return subprocess.run(['agent-browser','--session','cd4-isolated',*a],capture_output=True,text=True,check=True).stdout.strip()
def button(name):run('find','role','button','click','--name',name,'--exact');return run('snapshot','-i')
def tab(name):run('find','role','tab','click','--name',name,'--exact');return run('snapshot','-i')
def field(name,value):run('find','label',name,'fill',value,'--exact');return run('snapshot','-i')
def text():return json.loads(run('eval','document.querySelector(".cd4-main").textContent'))
def record(name):steps.append(name);(root/'interaction-result.json').write_text(json.dumps(steps,ensure_ascii=False,indent=2))
run('open',base+'?connection=openai');run('set','viewport','1340','953')
button('更换密钥');field('新的 API Key','synthetic-new-key');button('保存');run('wait','--text','新版本已保存')
assert 'v3' in text();tab('记录');assert 'v2' in text() and 'v1' in text();button('查看版本 2');assert '1 项任务保持这个版本' in text();record('换key生成v3，v2保留原1项任务引用')
button('返回记录');tab('连接');button('测试当前版本');run('wait','--text','当前版本测试通过');record('显式测试当前版本与保存分离')
button('查看密钥');field('当前登录密码','wrong');button('验证');assert '演示密码不正确' in text();field('当前登录密码','demo-123');button('验证');assert 'synthetic-demo-key-only' in text();tab('模型');assert 'synthetic-demo-key-only' not in text();record('同区域验证、错误修正、明文离开清除')
tab('连接');field('连接名称','gpt-image2 renamed');run('find','role','checkbox','click','--name','模拟失败','--exact');run('snapshot','-i');button('保存');run('wait','--text','模拟操作失败');assert 'gpt-image2 renamed' in text();run('find','role','checkbox','click','--name','模拟失败','--exact');run('snapshot','-i');button('保存');run('wait','--text','已保存。');record('失败保留草稿，取消模拟失败后原位置重试保存')
field('连接名称','unsaved draft');button('返回列表');assert '放弃未保存修改' in run('snapshot','-i');button('继续编辑');assert 'unsaved draft' in run('get','value','[aria-label="连接名称"]');button('返回列表');button('放弃修改');record('dirty离开可继续编辑或明确丢弃')
button('新建连接');field('连接名称','Demo MiniMax');run('find','role','combobox','click','--name','服务商','--exact');run('snapshot','-i');run('select','[aria-label="服务商"]','MiniMax');s=run('snapshot','-i');assert 'https://api.minimaxi.com' in s;tab('模型');assert 'MiniMax-H3' in text();tab('连接');field('新的 API Key','synthetic-only-new-key');button('保存');run('wait','--text','新版本已保存');button('返回列表');assert 'Demo MiniMax' in text();record('新建provider同步Endpoint/能力/模型，保存回同一列表')
button('密钥管理');button('gpt-image2 renamed');assert 'gpt-image2 renamed' in text();record('全局密钥可定位所属连接')
tab('连接');run('find','role','tab','click','--name','连接','--exact');run('press','ArrowRight');s=run('snapshot','-i');assert 'tab "模型" [selected' in s;assert 'variant=' not in run('get','url');record('页签方向键不切Demo密度')
tab('连接');field('连接名称','长名称'*35);button('保存');run('wait','--text','已保存。');m=json.loads(json.loads(run('eval','JSON.stringify({width:innerWidth,body:document.documentElement.scrollWidth,scroll:document.querySelector(".cd4-scroll").scrollWidth,client:document.querySelector(".cd4-scroll").clientWidth})')));assert m['width']>=m['body'] and m['client']>=m['scroll'];record('超长名称保持单一对象区域，无横向溢出')
print(json.dumps({'passed':len(steps),'steps':steps},ensure_ascii=False))
