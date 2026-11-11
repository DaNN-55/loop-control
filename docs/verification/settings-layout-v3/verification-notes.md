交互脚本首两次中断均为定位器编写错误：列表表头占据 first-child；主从布局的详情在 inspector 中，不嵌在选中行内。已读实际 DOM/source，分别改为 first-of-type 与详情容器定位，不修改产品实现来迁就测试。
