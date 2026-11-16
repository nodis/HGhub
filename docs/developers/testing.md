# 调试与验收

在插件“设置与日志”读取日志，先确认初始化，再调用具体方法。记录 requestId、错误码、字段路径，避免凭据。当前没有完整内置自检、日志文件导出；日志可选中复制。

| 症状 | 检查 |
| --- | --- |
| 安装后运行失败 | 工厂 I/O、必需方法、requires |
| 搜索为空 | 字段映射、条目校验、真实 ID |
| 第二页失败 | 游标、闭包状态、取消 |
| 图片或视频 403 | 资源请求头、Cookie 提供者、CDN 地址 |
| 刷新无效 | reason:refresh、过期缓存、毫秒有效期 |
| 页面流不能播 | 匹配解析器、页面是否误标为 MP4 |
| Android 列表失败 | content URI 相对条目限制 |

## 仓库验证

```powershell
pnpm install --frozen-lockfile
pnpm build
$env:CARGO_INCREMENTAL = '0'
cargo test --manifest-path src-tauri/crates/hpp/Cargo.toml --locked --lib --tests -j 2
cargo build --manifest-path src-tauri/crates/hpp/Cargo.toml --locked --example dev_host -j 2
node scripts/test-plugins.mjs
pnpm docs:build
pnpm docs:test
```

浏览器套件使用真实 Rust/QuickJS 和生产 React，仅用 stdio 代替 Tauri IPC；媒体由本地合成。它不等于原生窗口或实际站点验收。测试期间不要重建 Windows dev_host.exe。

播放体验可单独运行 `pnpm test:experience`（或在已有 dev_host 构建上运行 `node scripts/test-plugins.mjs --experience`）。覆盖首页轻量预览、详情确认、选集分页、预览会话接续、桌面全窗口播放、移动端控制和退出恢复；分类、搜索、收藏及历史入口应先显示详情，不自动播放。截图输出到 `output/playwright/watch-experience/`。原有搜索、设置和移动手势回归运行 `pnpm test:frontend`。

发布前检查：单文件与列表选装、重复导入、版本一致；搜索/首页→详情→真实分集→实际解码；第二页、切线、拖动、刷新、取消；重载与持久化。每个声称支持的平台都应验证本地会话到播放器的完整链路。

假宿主用于字段映射，不能证明隔离、配额、Cookie、媒体代理或原生解码。报告分别记录模拟、真实宿主、上游和设备验证。

## 代理与 Android release

设置 → 网络 → 代理访问支持跟随系统、自定义与直连。自定义支持 HTTP、HTTPS、SOCKS；保存后新请求生效，已缓冲的视频不会重新下载，必要时刷新播放。测试连接只使用当前草稿，不保存。直连关闭应用层代理，但不会绕过操作系统 VPN / TUN。

系统模式使用 `HGHUB_PROXY` 覆盖值或平台固定代理、代理环境变量；Android 读取系统 HTTP 代理属性，Linux 另支持 GNOME 手动代理。PAC 自动配置脚本不在当前支持范围。代理选择仍保留目标地址与重定向检查。

Android 的封面和媒体通过应用内 HTTP 回环服务提供。`scripts/sync-android-network.mjs` 在构建前将受版本管理的网络配置同步到生成工程，只允许 `127.0.0.1` 和 `localhost` 明文连接。重新执行 Android init 后也需同步；验收 release 时检查 APK 内的 manifest 与 XML，不能仅凭 debug 可播放判断 release 正常。

同一同步脚本也会复制 Android 的 `OrientationPlugin.kt`。播放器通过已注册的 `set_orientation` 命令切换 Activity 的系统方向，退出时恢复进入前的方向设置；横屏不再依赖 CSS 旋转。浏览器只能模拟视口尺寸变化，系统方向与状态栏行为需在 Android 上确认。

应用主 Cargo 清单的开发配置禁用增量编译，以避免当前 E: 文件系统不支持硬链接时出现旧增量对象的未解析符号。若已有损坏产物，可先执行 `cargo clean --manifest-path src-tauri/Cargo.toml -p hghub-hpp`，再运行 `pnpm app:dev`。
