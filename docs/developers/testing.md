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

发布前检查：单文件与列表选装、重复导入、版本一致；搜索/首页→详情→真实分集→实际解码；第二页、切线、拖动、刷新、取消；重载与持久化。每个声称支持的平台都应验证本地会话到播放器的完整链路。

假宿主用于字段映射，不能证明隔离、配额、Cookie、媒体代理或原生解码。报告分别记录模拟、真实宿主、上游和设备验证。
