import { useEffect, useState } from "react";
import { ICpu, IBack, IPlus, IGrid } from "../icons";
import { pluginError, type InstalledPlugin } from "../plugins/client";
import type { Endpoint, Setting } from "../plugins/protocol";
import { usePluginRequests } from "../plugins/usePluginRequests";
import PluginForms from "../plugins/PluginForms";
import PluginDistribution from "../plugins/PluginDistribution";
import { useHost } from "../plugins/HostContext";
const statuses: Record<InstalledPlugin["status"], string> = { ready: "已就绪", unloaded: "待加载", failed: "运行失败", incompatible: "不兼容", disabled: "已停用" };
function ErrorMessage({ error }: { error: string }) { return error ? <div className="hpp-error" role="alert">{error}</div> : null; }
export default function Plugins({onBack,focusId}: {onBack:()=>void;focusId?:string}) {
  const host=useHost();
  const plugins=host.plugins.filter(p=>host.prefs.mature||!p.meta.mature);
  return <div className="hpp-page hpp-plugins-page"><header className="hpp-header"><button aria-label="返回" onClick={onBack}><IBack size={20}/></button><div><h1>插件中心</h1><p>让喜欢的内容，在这里相遇</p></div></header><ErrorMessage error={host.error}/><PluginManagement plugins={plugins} reload={host.reload} focusId={focusId}/></div>;
}
function PluginManagement({ plugins, reload, focusId = "" }: { plugins: InstalledPlugin[]; reload: () => Promise<void>; focusId?: string }) {
  const request = usePluginRequests();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<string | null>(focusId || null);
  const [tab, setTab] = useState<"installed" | "import">("installed");
  useEffect(() => { if (focusId) { setOptions(focusId); setTab("installed"); } }, [focusId]);
  const perform = async (action: string, params: Record<string, unknown>) => { setBusy(true); setError(""); try { await request(action, params); await reload(); } catch (e) { setError(pluginError(e)); } finally { setBusy(false); } };
  return <><nav className="hpp-provider-tabs" aria-label="插件中心分栏"><button aria-pressed={tab === "installed"} onClick={() => setTab("installed")}><ICpu size={17}/>已安装 <small>{plugins.length}</small></button><button aria-pressed={tab === "import"} onClick={() => setTab("import")}><IPlus size={17}/>导入与订阅</button></nav><div className="hpp-scroll"><div className="hpp-content">
    <div hidden={tab !== "import"}><PluginDistribution plugins={plugins} reload={reload} /></div>
    <div hidden={tab !== "installed"}>
    <ErrorMessage error={error} />
    <div className="hpp-section-title"><p className="hpp-muted">管理片源、账号与播放解析器</p><button className="primary" onClick={() => setTab("import")}><IPlus size={15}/>添加插件</button></div>
    {!plugins.length && <div className="hpp-empty"><ICpu size={40}/><h2>你的插件库，等待第一位成员</h2><p>导入数据源开始观看，或添加解析器拓展播放能力。</p><button className="primary" onClick={() => setTab("import")}>导入插件</button></div>}
    {(["source","resolver"] as const).map(kind => <section className="hpp-plugin-group" key={kind}>{plugins.some(p => (p.meta.kind === "resolver") === (kind === "resolver")) && <h2>{kind === "source" ? "数据源" : "解析器"}<small>{plugins.filter(p => (p.meta.kind === "resolver") === (kind === "resolver")).length}</small></h2>}<div className="hpp-installed">{plugins.filter(p => (p.meta.kind === "resolver") === (kind === "resolver")).map(p => <article className="hpp-plugin" key={p.meta.id}>
      <div className="hpp-plugin-heading"><span className="hpp-plugin-icon"><IGrid size={22} /></span><div><h3>{p.meta.name}<small>{p.meta.kind === "resolver" ? "解析器" : "数据源"}</small></h3><p>{p.meta.id} · v{p.meta.version}</p></div><span className={`hpp-status ${p.status}`}>{statuses[p.status]}</span></div>
      {p.meta.description && <p>{p.meta.description}</p>}<ErrorMessage error={p.error?.message || ""} /><p className="hpp-muted">{p.origin?.manifestName && <span>{p.origin.manifestName} · </span>}{p.source || "粘贴代码"}</p>
      <div className="hpp-plugin-footer"><span>{p.methods.length} 项已发现能力{p.endpoint ? ` · ${p.endpoint.label || p.endpoint.id}` : ""}</span><div>
        <button disabled={busy} onClick={() => void perform("enable", { id: p.meta.id, enabled: !p.enabled })}>{p.enabled ? "停用" : "启用"}</button>
        {p.enabled && p.status !== "ready" && <button disabled={busy} onClick={() => void perform("retry", { id: p.meta.id })}>重试初始化</button>}
        {p.canRestore && <button disabled={busy} onClick={() => void perform("restore", { id: p.meta.id })}>恢复上一可用版本</button>}
        <button onClick={() => setOptions(options === p.meta.id ? null : p.meta.id)}>{options === p.meta.id ? "收起" : "设置与日志"}</button>
        <button className="danger" disabled={busy} onClick={() => { if (window.confirm(`移除「${p.meta.name}」及其本地存储与 Cookie？`)) void perform("remove", { id: p.meta.id }); }}>移除</button>
      </div></div>
      {options === p.meta.id && <PluginOptions key={p.meta.id + p.revision} plugin={p} reload={reload} />}
    </article>)}</div></section>)}
    </div>
  </div></div></>;
}

function PluginOptions({ plugin: p, reload }: { plugin: InstalledPlugin; reload: () => Promise<void> }) {
  const request = usePluginRequests();
  const [settings, setSettings] = useState<Record<string, unknown>>({}), [endpoints, setEndpoints] = useState<Endpoint[]>([]), [logs, setLogs] = useState<unknown[]>([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<{id:string;url:string;ok:boolean;latencyMs:number;status?:number;error?:string}[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    void request<Record<string, unknown>>("settings.get", { id: p.meta.id }).then(values => { setSettings(values); setSettingsLoaded(true); }).catch(e => setError(pluginError(e)));
    if (p.enabled && p.methods.includes("endpoints.list")) void request<Endpoint[]>("endpoint.list", { id: p.meta.id, refresh: false }).then(setEndpoints).catch(e => setError(pluginError(e)));
  }, [p.meta.id]);
  const update = async (action: string, data: Record<string, unknown>) => {
    setBusy(true); setError(""); setNotice(""); try { await request(action, { id: p.meta.id, ...data }); await reload(); setNotice("设置已保存"); } catch (e) { setError(pluginError(e)); } finally { setBusy(false); }
  };
  return <div className="hpp-options"><ErrorMessage error={error} />
    <PluginForms plugin={p} />
    {p.meta.settings?.map(s => <div className="hpp-setting" key={s.key}><label htmlFor={`setting-${s.key}`}>{s.label}<small>{s.description}</small></label><SettingInput setting={s} value={settings[s.key]} disabled={busy || !settingsLoaded} onChange={v => setSettings(old => ({ ...old, [s.key]: v }))} /><button disabled={busy || !settingsLoaded} onClick={() => void update("settings.set", { key: s.key, value: settings[s.key] })}>保存</button></div>)}
    {notice && <p role="status" className="hpp-muted">{notice}</p>}
    {!!endpoints.length && <label className="hpp-setting">站点线路<select value={p.endpoint?.id || ""} disabled={busy} onChange={e => void update("endpoint.set", { endpointId: e.target.value })}>{endpoints.map(e => <option value={e.id} key={e.id}>{e.label || e.id} · {e.url}</option>)}</select></label>}
    {p.enabled && p.methods.includes("endpoints.list") && <div className="hpp-distribution-buttons"><button disabled={busy} onClick={() => {
      setBusy(true); setError(""); void request<Endpoint[]>("endpoint.list", {id:p.meta.id,refresh:true}).then(async r=>{setEndpoints(r);setProbes([]);await reload();}).catch(e=>setError(pluginError(e))).finally(()=>setBusy(false));
    }}>刷新站点线路</button><button disabled={busy} onClick={() => {
      setBusy(true);setError("");void request<typeof probes>("endpoint.probe", {id:p.meta.id}).then(setProbes).catch(e=>setError(pluginError(e))).finally(()=>setBusy(false));
    }}>探测站点线路</button></div>}
    {!!probes.length && <ul className="hpp-probes">{probes.map(result=><li key={result.id}>{endpoints.find(e=>e.id===result.id)?.label||result.id} · {result.ok?`可达 · ${result.latencyMs} ms`:result.error||`HTTP ${result.status}`}</li>)}</ul>}
    <button onClick={() => void request<unknown[]>("logs", { id: p.meta.id }).then(setLogs).catch(e => setError(pluginError(e)))}>读取运行日志</button>
    {!!logs.length && <pre className="hpp-logs">{logs.map(x => JSON.stringify(x)).join("\n")}</pre>}
  </div>;
}
function SettingInput({ setting: s, value, disabled, onChange }: { setting: Setting; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const id = `setting-${s.key}`;
  if (s.type === "switch") return <input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={e => onChange(e.target.checked)} />;
  if (s.type === "select") return <select id={id} disabled={disabled} value={String(value ?? "")} onChange={e => onChange(e.target.value)}>{s.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  return <input id={id} type={s.type === "number" ? "number" : s.type === "password" ? "password" : "text"} disabled={disabled} placeholder={s.placeholder} min={s.min} max={s.max} value={String(value ?? "")} onChange={e => onChange(s.type === "number" ? Number(e.target.value) : e.target.value)} />;
}
