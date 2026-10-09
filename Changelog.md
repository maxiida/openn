## v2.5.5

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- Fix desktop app connectivity by making whole-device routing the default, with guided setup and an explicit system-proxy fallback.
- Fix macOS connections failing to start after successful service authorization.
- 修复单节点或无分流规则的订阅连接后国内网站也走代理的问题
- 修复 DNS 覆写：空内容报错、初始值覆盖已有设置、已填写字段残留原配置、空字段在高级编辑器中缺失
- 修复 macOS 系统代理偶发设置失败、内核启动失败的问题；其他 VPN（如 Shadowrocket）接管网络时给出明确提示
- 修复连接成功后因清理系统代理失败而被自动断开的问题
- 修复每次启动都询问安装一个无法安装的旧更新的问题

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- Rebrand the app as Openn with a white app icon.
- 优化节点列表：测速后按延迟从低到高排列
- macOS：移除窗口顶部的应用标题栏
- 简化连接界面：只保留连接与断开，托盘不再提供出站模式、系统代理和 TUN 开关
- 优化系统服务版本检查：版本与当前应用要求不一致时，提示卸载后重新安装
- 简化提醒：所有提醒统一显示在窗口最上层，同一时间只提示一个问题，文案改为直白说明
- 连接时不再询问是否只让浏览器走代理，统一让所有应用都走代理
- 每天首次连接后自动更新一次当前订阅，订阅管理中显示每个订阅的更新时间

</details>
