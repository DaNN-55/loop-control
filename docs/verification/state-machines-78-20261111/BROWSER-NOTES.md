浏览器首次脚本等待 hidden file input 可见而超时，第二次改用 JavaScript 条件时转义错误；两次均在上传前停止，非产品失败。检查 DOM 后改为等待可见的真实组件区域，再对隐藏 input 上传。验收 HTML 补齐与主程序一致的 data-interface 主题入口。
后续脚本同类 selector 字符串已统一避免嵌套引号。实际窄屏点击暴露素材架绝对定位向上越过父容器、按钮被标题覆盖，已以 <=900px 文档流修复并重新验证。隔离服务补齐主题入口、真实 connections.serviceCatalog 回包及占位图片；最终截图不混入无关目录读取错误。
