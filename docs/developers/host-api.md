# 能力与宿主 API

## 选择能力

| 场景 | 最低方法 | 可增加 |
| --- | --- | --- |
| 点播 | media.getDetail、media.resolvePlayback | search、home、catalog、分集分页 |
| 纯直播 | live.getGroups、live.listChannels、live.resolve | 节目单、图文 |
| 播放页解析 | resolver.resolve，meta.kind 为 resolver | matches、账号、资源变换 |
| 图文 | articles.list、articles.getDetail | 当前 source 仍须具备 media 或 live |
| 登录 | auth 的全部四个方法 | 多步表单；WebView 当前不可用 |

声明命名空间就要实现其必需方法，不要用空函数伪装支持；忽略未知 params 字段。插件只返回数据，不能绘制 UI。需要输入时使用设置或 auth/ui 表单。详见[能力模块](../plugin-protocol/06-capabilities.md)。

## 调用宿主

| 用途 | 模块 | 注意事项 |
| --- | --- | --- |
| 网络 | hg.http | 非 2xx 返回响应，插件映射业务错误 |
| 持久化 | hg.storage | 5 MiB/插件，256 KiB/值，支持 TTL |
| Cookie | hg.cookies | 每插件独立罐，不能共享其他源账号 |
| 摘要/对称加密 | hg.crypto | HMAC、AES、随机数；RSA 尚缺 |
| 编解码 | hg.codec | UTF-8、Base64、Hex、legacy charset |
| HTML | hg.html | 节点仅当前调用内使用，不可作为业务返回值 |
| 设置 | hg.settings | 保存后宿主重建插件 |
| 日志 | hg.log、console | 本地日志，不写密码、Cookie、签名 URL |

工厂只构造对象并读取设置，不做网络、存储、Cookie 或 HTML 操作。方法接收 `(params, ctx)`；读取一般 15 秒，播放一般 20 秒。将 ctx.signal 传给 HTTP。调用结束后任务清理，没有自由后台执行。

每个插件使用独立 QuickJS，调用可以在 await 之间交错。不要把当前请求参数或信号放在共享闭包变量中；需持久状态使用存储。

业务数据允许普通对象、数组、有限数字、字符串、布尔、null、Uint8Array。对象 undefined 属性丢弃；数组不能有 undefined/空位。不得返回 Date、Map、类实例、函数或环。总值最多 8 MiB、深度 32 层。

## 播放

返回 `streams`，MP4 使用 progressive，HLS 使用 hls。页面流为 kind:page，由解析器处理。图片使用 ImageRef，所有资源走所属插件媒体会话。

备用线路用 servers；按 serverId 只解析当前线路。有效期为 Unix 毫秒；reason:refresh 必须更新地址。不要用 index 猜跨来源同一集，也不要用上游 resumeSec 覆盖宿主本地进度。

完整签名见[宿主 API](../plugin-protocol/04-host-api.md)、[内容模型](../plugin-protocol/05-content-model.md)与[媒体传输](../plugin-protocol/09-media-transport.md)。类型表示设计契约，实际缺口见[支持状态](status.md)。
