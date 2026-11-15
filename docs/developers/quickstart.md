# 制作第一个插件

交付一个 UTF-8 ES 模块，只导出 `meta` 和默认工厂。文件不超过 2 MiB，不使用外部 import。下载[完整虚构示例](../../examples/plugin-hello.js)，在插件设置填写自己控制的 HTTPS MP4 地址后验证播放。示例没有外部测试视频依赖。

```js
export const meta = { id: 'example.hello', name: '虚构示例', version: '1.0.0', protocol: 1 };
export default hg => ({
  media: {
    getDetail({ id }) {
      return { id, title: '示例短片', playlists: [{ id: 'main', episodes: [{ id: 'first', index: 1, label: '第一集' }] }] };
    },
    resolvePlayback() {
      throw new hg.PluginError('UNSUPPORTED', '请先配置自己的媒体地址');
    },
  },
  search: { search({ query }) { return { items: [{ id: 'demo', title: query || '示例短片' }], next: null }; } },
});
```

上面代码验证安装、搜索和详情。完整示例额外提供可配置的播放方法与首页。

## 接入站点

先观察正常访问站点时的请求与响应，记录列表、详情、分集和单次播放解析。不要猜接口或把会过期的播放地址当作品 ID。

```js
const response = await hg.http.fetch({
  url: 'https://api.example.com/search', query: { q: query },
  responseType: 'json', signal: ctx.signal,
});
if (!response.ok) throw new hg.PluginError('UPSTREAM_ERROR', '来源暂时不可用');
if (!Array.isArray(response.data.items)) throw new hg.PluginError('UPSTREAM_CHANGED', '来源结构已变化');
return { items: response.data.items.map(row => ({ id: String(row.id), title: row.title })), next: response.data.next || null };
```

占位域名必须替换为已验证的地址。保留真实作品、播放列表和分集 ID；index 仅表示顺序。分页游标应在插件重载后仍能使用。媒体及必要的请求头放入资源对象，由宿主处理。

## 导入

打开“插件中心 → 导入与订阅”，选择文件或粘贴源码。确认状态“已就绪”，从搜索进入详情和选集。修改代码可同 ID、同版本重新导入；新修订会停止旧媒体会话。按[验证步骤](testing.md)检查正常路径、错误、取消、第二页与重载。
