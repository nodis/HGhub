use crate::{
    model::Meta,
    network_policy,
    store::{atomic_write, now},
    wire::Transfer,
    PluginError, Result,
};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Method, Response,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedCookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    host_only: bool,
    secure: bool,
    http_only: bool,
    expires_at: Option<u64>,
}
pub struct Network {
    pub meta: Meta,
    pub strict_override: Option<bool>,
    jar: Mutex<Vec<SavedCookie>>,
    jar_path: PathBuf,
    gate: tokio::sync::Semaphore,
    rate: Mutex<(f64, Instant)>,
    cache: Mutex<HashMap<String, CachedResponse>>,
    pub cooldown: Arc<Mutex<HashMap<String, Instant>>>,
}
struct CachedResponse {
    value: Transfer,
    expires: Instant,
    bytes: usize,
}
impl Network {
    pub fn new(
        meta: Meta,
        dir: PathBuf,
        strict: Option<bool>,
        cooldown: Arc<Mutex<HashMap<String, Instant>>>,
    ) -> Result<Self> {
        let jar_path = dir.join("cookies.json");
        let jar = if jar_path.exists() {
            serde_json::from_slice(&std::fs::read(&jar_path)?)
                .map_err(|_| PluginError::internal("Cookie 存储损坏"))?
        } else {
            vec![]
        };
        Ok(Self {
            meta,
            strict_override: strict,
            jar: Mutex::new(jar),
            jar_path,
            gate: tokio::sync::Semaphore::new(6),
            rate: Mutex::new((15.0, Instant::now())),
            cache: Mutex::new(HashMap::new()),
            cooldown,
        })
    }
    pub fn strict(&self) -> bool {
        self.strict_override
            .unwrap_or_else(network_policy::strict_security)
    }
    pub fn target(&self, raw: &str) -> Result<Url> {
        crate::model::url(raw, self.meta.allow_insecure_http, false)?;
        network_policy::parse_target_with_mode(raw, self.strict())
            .map_err(|e| PluginError::new("NETWORK", e))
    }
    fn matches(c: &SavedCookie, u: &Url) -> bool {
        let h = u.host_str().unwrap_or("");
        let path = u.path();
        let domain = h == c.domain || !c.host_only && h.ends_with(&format!(".{}", c.domain));
        let p = path == c.path
            || path.starts_with(&c.path)
                && (c.path.ends_with('/') || path.as_bytes().get(c.path.len()) == Some(&b'/'));
        domain
            && p
            && (!c.secure || u.scheme() == "https")
            && c.expires_at.is_none_or(|t| t > now())
    }
    fn save_jar(&self, jar: &[SavedCookie]) -> Result<()> {
        atomic_write(
            &self.jar_path,
            &serde_json::to_vec(jar).map_err(|_| PluginError::internal("无法保存 Cookie"))?,
        )
    }
    fn put_cookie(&self, u: &Url, v: Value) -> Result<()> {
        let host = u
            .host_str()
            .ok_or_else(|| PluginError::invalid("Cookie URL 缺少主机"))?;
        let domain = v["domain"]
            .as_str()
            .unwrap_or(host)
            .trim_start_matches('.')
            .to_ascii_lowercase();
        if domain != host && !host.ends_with(&format!(".{domain}")) {
            return Err(PluginError::invalid("Cookie domain 与 URL 不匹配"));
        }
        let host_only = v["hostOnly"].as_bool().unwrap_or(v.get("domain").is_none());
        if host_only && domain != host {
            return Err(PluginError::invalid("hostOnly Cookie 必须绑定当前主机"));
        }
        let c = SavedCookie {
            name: v["name"]
                .as_str()
                .ok_or_else(|| PluginError::invalid("Cookie 缺少名称"))?
                .into(),
            value: v["value"]
                .as_str()
                .ok_or_else(|| PluginError::invalid("Cookie 缺少值"))?
                .into(),
            domain,
            path: v["path"].as_str().unwrap_or("/").into(),
            host_only,
            secure: v["secure"].as_bool().unwrap_or(false),
            http_only: v["httpOnly"].as_bool().unwrap_or(false),
            expires_at: v["expiresAt"].as_u64(),
        };
        if c.name.is_empty()
            || c.name.len() + c.value.len() > 16384
            || c.name.chars().any(|c| c.is_control() || ";= ".contains(c))
            || c.value.chars().any(|c| c.is_control() || c == ';')
        {
            return Err(PluginError::invalid("Cookie 名称或值无效"));
        }
        let mut jar = self.jar.lock().unwrap();
        let mut next = jar.clone();
        next.retain(|x| !(x.name == c.name && x.domain == c.domain && x.path == c.path));
        if c.expires_at.is_none_or(|t| t > now()) {
            next.push(c);
        }
        if next.len() > 3000 {
            return Err(PluginError::invalid("Cookie 数量超限"));
        }
        self.save_jar(&next)?;
        *jar = next;
        Ok(())
    }
    pub fn cookies(&self, op: &str, p: Value) -> Result<Value> {
        let u = p["url"].as_str().map(|s| self.target(s)).transpose()?;
        match op {
            "get" => {
                let u = u.ok_or_else(|| PluginError::invalid("缺少 Cookie URL"))?;
                Ok(json!(self
                    .jar
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|c| Self::matches(c, &u))
                    .collect::<Vec<_>>()))
            }
            "set" => {
                self.put_cookie(
                    &u.ok_or_else(|| PluginError::invalid("缺少 Cookie URL"))?,
                    p["cookie"].clone(),
                )?;
                Ok(Value::Null)
            }
            "clear" => {
                let mut jar = self.jar.lock().unwrap();
                let mut next = jar.clone();
                next.retain(|c| u.as_ref().is_some_and(|u| !Self::matches(c, u)));
                self.save_jar(&next)?;
                *jar = next;
                Ok(Value::Null)
            }
            _ => Err(PluginError::invalid("未知 Cookie 操作")),
        }
    }
    fn receive_cookies(&self, u: &Url, headers: &HeaderMap) -> Result<()> {
        for h in headers.get_all("set-cookie") {
            if let Ok(s) = h.to_str() {
                if let Ok(c) = cookie::Cookie::parse(s.to_string()) {
                    let default_path = u
                        .path()
                        .rsplit_once('/')
                        .map(|(s, _)| if s.is_empty() { "/" } else { s })
                        .unwrap_or("/");
                    let mut v = json!({"name":c.name(),"value":c.value(),"path":c.path().unwrap_or(default_path),"secure":c.secure().unwrap_or(false),"httpOnly":c.http_only().unwrap_or(false)});
                    if let Some(d) = c.domain() {
                        v["domain"] = json!(d);
                    }
                    if let Some(age) = c.max_age() {
                        v["expiresAt"] = json!(if age.whole_seconds() <= 0 {
                            0
                        } else {
                            now().saturating_add(age.whole_milliseconds() as u64)
                        });
                    } else if let Some(t) = c.expires_datetime() {
                        v["expiresAt"] = json!((t.unix_timestamp().max(0) as u64) * 1000);
                    }
                    // Ignore individual invalid upstream cookies, as browsers do.
                    let _ = self.put_cookie(u, v);
                }
            }
        }
        Ok(())
    }
    async fn rate_limit(&self, cancel: &CancellationToken) -> Result<()> {
        loop {
            {
                let mut r = self.rate.lock().unwrap();
                let elapsed = r.1.elapsed().as_secs_f64();
                r.0 = (r.0 + elapsed * 5.0).min(15.0);
                r.1 = Instant::now();
                if r.0 >= 1.0 {
                    r.0 -= 1.0;
                    return Ok(());
                }
            }
            tokio::select! {_=cancel.cancelled()=>return Err(PluginError::cancelled()),_=tokio::time::sleep(Duration::from_millis(50))=>{}}
        }
    }
    pub async fn request(
        &self,
        raw: &str,
        method: Method,
        headers: HeaderMap,
        body: Option<Vec<u8>>,
        cookies: bool,
        follow: bool,
        cancel: &CancellationToken,
    ) -> Result<Response> {
        let mut target = self.target(raw)?;
        let initial = target.origin();
        let mut explicit = headers;
        for hop in 0..=5 {
            if cancel.is_cancelled() {
                return Err(PluginError::cancelled());
            }
            let host = target.host_str().unwrap().to_string();
            if let Some(until) = self.cooldown.lock().unwrap().get(&host).copied() {
                if until > Instant::now() {
                    let mut e = PluginError::new("RATE_LIMITED", "该主机正在冷却");
                    e.retry_after_sec = Some(until.duration_since(Instant::now()).as_secs().max(1));
                    return Err(e);
                }
            }
            let addrs = tokio::select! {_=cancel.cancelled()=>return Err(PluginError::cancelled()),v=network_policy::resolve_target(&target,self.strict())=>v.map_err(|e|PluginError::new("NETWORK",e))?};
            let mut builder = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .referer(false)
                .connect_timeout(Duration::from_secs(10))
                .user_agent("HGhub/HPP-dev")
                .resolve_to_addrs(&host, &addrs);
            if let Ok(proxy) = std::env::var("HGHUB_PROXY") {
                if !proxy.trim().is_empty() {
                    builder = builder.proxy(
                        reqwest::Proxy::all(proxy)
                            .map_err(|_| PluginError::new("NETWORK", "代理配置无效"))?,
                    );
                }
            }
            let client = builder
                .build()
                .map_err(|_| PluginError::new("NETWORK", "无法创建 HTTP 客户端"))?;
            if target.origin() != initial {
                explicit.remove("authorization");
                explicit.remove("cookie");
            }
            let mut h = explicit.clone();
            if cookies && !h.contains_key("cookie") {
                let mut jar = self
                    .jar
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|c| Self::matches(c, &target))
                    .cloned()
                    .collect::<Vec<_>>();
                jar.sort_by_key(|c| std::cmp::Reverse(c.path.len()));
                let s = jar
                    .iter()
                    .map(|c| format!("{}={}", c.name, c.value))
                    .collect::<Vec<_>>()
                    .join("; ");
                if !s.is_empty() {
                    h.insert(
                        "cookie",
                        HeaderValue::from_str(&s)
                            .map_err(|_| PluginError::invalid("Cookie 无效"))?,
                    );
                }
            }
            let mut req = client.request(method.clone(), target.clone()).headers(h);
            if let Some(b) = &body {
                req = req.body(b.clone());
            }
            let resp = tokio::select! {_=cancel.cancelled()=>return Err(PluginError::cancelled()),v=req.send()=>v.map_err(|_|PluginError::new("NETWORK","HTTP 连接失败"))?};
            if cookies {
                self.receive_cookies(&target, resp.headers())?;
            }
            if matches!(resp.status().as_u16(), 429 | 503) {
                if let Some(sec) = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                {
                    self.cooldown
                        .lock()
                        .unwrap()
                        .insert(host, Instant::now() + Duration::from_secs(sec.min(600)));
                }
            }
            if follow && matches!(resp.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                if hop == 5 {
                    return Err(PluginError::new("NETWORK", "重定向次数超过上限"));
                }
                let loc = resp
                    .headers()
                    .get("location")
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| PluginError::new("NETWORK", "重定向缺少 Location"))?;
                let next = target
                    .join(loc)
                    .map_err(|_| PluginError::new("NETWORK", "重定向地址无效"))?;
                if target.scheme() == "https" && next.scheme() != "https" {
                    return Err(PluginError::new("NETWORK", "禁止 HTTPS 降级"));
                }
                target = self.target(next.as_str())?;
                continue;
            }
            return Ok(resp);
        }
        Err(PluginError::new("NETWORK", "重定向失败"))
    }
    pub async fn fetch(&self, p: Transfer, cancel: CancellationToken) -> Result<Transfer> {
        let v = p.json();
        let effective = headers(&v["headers"])?;
        let method = v["method"].as_str().unwrap_or("GET");
        let retries = v["retry"].as_u64().unwrap_or(0).min(2);
        let eligible = method == "GET"
            && v["credentials"] == "omit"
            && !effective.contains_key("authorization")
            && !effective.contains_key("cookie")
            && v["cache"].is_object();
        let ttl = v["cache"]["ttlSec"]
            .as_f64()
            .unwrap_or(0.0)
            .clamp(0.0, 86400.0);
        let stale = v["cache"]["staleIfErrorSec"]
            .as_f64()
            .unwrap_or(0.0)
            .clamp(0.0, 604800.0);
        let mut key = v.clone();
        if let Some(o) = key.as_object_mut() {
            for k in ["cache", "retry", "timeoutMs"] {
                o.remove(k);
            }
            o.insert(
                "headers".into(),
                json!(effective
                    .iter()
                    .map(|(k, v)| (k.as_str(), v.to_str().unwrap_or("")))
                    .collect::<std::collections::BTreeMap<_, _>>()),
            );
        }
        let key = key.to_string();
        let mut old = None;
        if eligible {
            if let Some(entry) = self.cache.lock().unwrap().get(&key) {
                if entry.expires > Instant::now() {
                    return Ok(cached(entry.value.clone()));
                }
                if Instant::now().duration_since(entry.expires).as_secs_f64() <= stale {
                    old = Some(entry.value.clone());
                }
            }
        }
        let mut attempt = 0;
        loop {
            let result = self.fetch_once(p.clone(), cancel.clone()).await;
            let failed = match &result {
                Err(e) => {
                    matches!(e.code.as_str(), "NETWORK" | "TIMEOUT")
                        || e.details
                            .as_ref()
                            .and_then(|d| d["status"].as_u64())
                            .is_some_and(|s| s >= 500)
                }
                Ok(v) => v.json()["status"].as_u64().is_some_and(|s| s >= 500),
            };
            if failed && matches!(method, "GET" | "HEAD") && attempt < retries {
                let host = v["url"]
                    .as_str()
                    .and_then(|u| Url::parse(u).ok())
                    .and_then(|u| u.host_str().map(String::from))
                    .unwrap_or_default();
                let cooling = self
                    .cooldown
                    .lock()
                    .unwrap()
                    .get(&host)
                    .is_some_and(|t| *t > Instant::now());
                if !cooling {
                    let delay = if attempt == 0 { 400 } else { 1200 };
                    attempt += 1;
                    tokio::select! {_=cancel.cancelled()=>return Err(PluginError::cancelled()),_=tokio::time::sleep(Duration::from_millis(delay))=>{}};
                    continue;
                }
            }
            if failed {
                if let Some(value) = old {
                    return Ok(cached(value));
                }
            }
            if eligible {
                if let Ok(value) = &result {
                    let response = value.json();
                    let control = response["headers"]["cache-control"]
                        .as_str()
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    if response["ok"] == true
                        && response["setCookies"].as_array().is_some_and(Vec::is_empty)
                        && !response["headers"]["vary"]
                            .as_str()
                            .unwrap_or("")
                            .split(',')
                            .any(|s| s.trim() == "*")
                        && !control.split(',').any(|s| s.trim() == "no-store")
                    {
                        let bytes = serde_json::to_vec(value)
                            .map(|v| v.len())
                            .unwrap_or(usize::MAX);
                        if bytes <= 8 * 1024 * 1024 && ttl > 0.0 {
                            let mut cache = self.cache.lock().unwrap();
                            cache.remove(&key);
                            while !cache.is_empty()
                                && cache.values().map(|e| e.bytes).sum::<usize>() + bytes
                                    > 8 * 1024 * 1024
                            {
                                let oldest = cache
                                    .iter()
                                    .min_by_key(|(_, e)| e.expires)
                                    .map(|(k, _)| k.clone())
                                    .unwrap();
                                cache.remove(&oldest);
                            }
                            cache.insert(
                                key,
                                CachedResponse {
                                    value: value.clone(),
                                    expires: Instant::now() + Duration::from_secs_f64(ttl),
                                    bytes,
                                },
                            );
                        }
                    }
                }
            }
            return result;
        }
    }
    async fn fetch_once(&self, p: Transfer, cancel: CancellationToken) -> Result<Transfer> {
        let v = p.json();
        let wait = self.gate.acquire();
        let _permit = tokio::select! {_=cancel.cancelled()=>return Err(PluginError::cancelled()),v=wait=>v.map_err(|_|PluginError::internal("网络队列已关闭"))?};
        self.rate_limit(&cancel).await?;
        let timeout =
            Duration::from_millis(v["timeoutMs"].as_u64().unwrap_or(15000).clamp(1, 30000));
        let work = async {
            let mut u = self.target(
                v["url"]
                    .as_str()
                    .ok_or_else(|| PluginError::invalid("缺少请求 URL"))?,
            )?;
            if let Some(q) = v["query"].as_object() {
                for (k, v) in q {
                    u.query_pairs_mut().append_pair(
                        k,
                        &v.as_str()
                            .map(String::from)
                            .unwrap_or_else(|| v.to_string()),
                    );
                }
            }
            let method = Method::from_bytes(v["method"].as_str().unwrap_or("GET").as_bytes())
                .map_err(|_| PluginError::invalid("请求 method 无效"))?;
            if !matches!(
                method.as_str(),
                "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"
            ) {
                return Err(PluginError::invalid("不支持该请求 method"));
            }
            let mut headers = headers(&v["headers"])?;
            let mut body = None;
            if let Some(b) = p.field("body") {
                if method == Method::GET || method == Method::HEAD {
                    return Err(PluginError::invalid("GET/HEAD 不允许 body"));
                }
                let j = b.json();
                body = Some(if let Some(j) = j.get("json") {
                    if !headers.contains_key("content-type") {
                        headers
                            .insert("content-type", HeaderValue::from_static("application/json"));
                    }
                    serde_json::to_vec(j).unwrap()
                } else if let Some(form) = j["form"].as_object() {
                    if !headers.contains_key("content-type") {
                        headers.insert(
                            "content-type",
                            HeaderValue::from_static("application/x-www-form-urlencoded"),
                        );
                    }
                    let mut ser = url::form_urlencoded::Serializer::new(String::new());
                    for (k, v) in form {
                        ser.append_pair(
                            k,
                            v.as_str()
                                .ok_or_else(|| PluginError::invalid("form 值必须为字符串"))?,
                        );
                    }
                    ser.finish().into_bytes()
                } else {
                    b.bytes()?
                });
                if body.as_ref().unwrap().len() > 1024 * 1024 {
                    return Err(PluginError::invalid("请求 body 超过 1 MiB"));
                }
            }
            let follow = body.is_none() && v["redirect"] != "manual";
            let mut resp = self
                .request(
                    u.as_str(),
                    method,
                    headers,
                    body,
                    v["credentials"] != "omit",
                    follow,
                    &cancel,
                )
                .await?;
            let max = v["maxBytes"]
                .as_u64()
                .unwrap_or(2 * 1024 * 1024)
                .clamp(1, 8 * 1024 * 1024) as usize;
            let mut meta = json!({"status":resp.status().as_u16(),"ok":resp.status().is_success(),"url":resp.url().as_str(),"headers":{},"setCookies":[],"fromCache":false});
            for (k, v) in resp.headers() {
                if let Ok(s) = v.to_str() {
                    meta["headers"][k.as_str()] = json!(s);
                }
            }
            meta["setCookies"] = json!(resp
                .headers()
                .get_all("set-cookie")
                .iter()
                .filter_map(|v| v.to_str().ok())
                .collect::<Vec<_>>());
            let charset = v["charset"]
                .as_str()
                .map(String::from)
                .or_else(|| {
                    meta["headers"]["content-type"].as_str().and_then(|s| {
                        s.split(';').find_map(|x| {
                            x.trim()
                                .strip_prefix("charset=")
                                .map(|s| s.trim_matches('"').to_string())
                        })
                    })
                })
                .unwrap_or_else(|| "utf-8".into());
            let mut bytes = vec![];
            while let Some(chunk) = tokio::select! {_=cancel.cancelled()=>return Err(PluginError::cancelled()),v=resp.chunk()=>v.map_err(|_|PluginError::new("NETWORK","响应读取失败"))?}
            {
                if bytes.len() + chunk.len() > max {
                    return Err(PluginError::new("UPSTREAM_ERROR", "响应体超过 maxBytes"));
                }
                bytes.extend_from_slice(&chunk);
            }
            let data = if v["responseType"] == "bytes" {
                Transfer::Bytes(bytes)
            } else {
                let enc = encoding_rs::Encoding::for_label(charset.as_bytes())
                    .ok_or_else(|| PluginError::invalid("不支持该字符集"))?;
                let (text, _, _) = enc.decode(&bytes);
                if v["responseType"] == "json" {
                    Transfer::from_json(serde_json::from_str(&text).map_err(|_| {
                        let mut error = PluginError::new("UPSTREAM_CHANGED", "响应不是合法 JSON");
                        error.details = Some(json!({"status":meta["status"]}));
                        error
                    })?)
                } else {
                    Transfer::String(text.into_owned())
                }
            };
            let mut result = Transfer::from_json(meta);
            if let Transfer::Object(ref mut m) = result {
                m.insert("data".into(), data);
            }
            result.validate(8 * 1024 * 1024)?;
            Ok(result)
        };
        tokio::select! {_=cancel.cancelled()=>Err(PluginError::cancelled()),v=tokio::time::timeout(timeout,work)=>v.unwrap_or_else(|_|Err(PluginError::timeout()))}
    }
}
fn cached(mut value: Transfer) -> Transfer {
    if let Transfer::Object(ref mut o) = value {
        o.insert("fromCache".into(), Transfer::Bool(true));
    }
    value
}
pub fn headers(v: &Value) -> Result<HeaderMap> {
    let mut out = HeaderMap::new();
    let mut size = 0;
    if !v.is_null() && !v.is_object() {
        return Err(PluginError::invalid("headers 必须为对象"));
    }
    if let Some(m) = v.as_object() {
        for (k, v) in m {
            let k = HeaderName::from_bytes(k.as_bytes())
                .map_err(|_| PluginError::invalid("请求头名称无效"))?;
            if matches!(
                k.as_str(),
                "host" | "content-length" | "connection" | "transfer-encoding" | "accept-encoding"
            ) {
                continue;
            }
            let s = v
                .as_str()
                .ok_or_else(|| PluginError::invalid("请求头值必须为字符串"))?;
            size += k.as_str().len() + s.len();
            if size > 16384 {
                return Err(PluginError::invalid("请求头超过 16 KiB"));
            }
            out.insert(
                k,
                HeaderValue::from_str(s).map_err(|_| PluginError::invalid("请求头值无效"))?,
            );
        }
    }
    Ok(out)
}
