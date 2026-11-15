import { useEffect, useMemo, useRef, useState } from "react";
import { useHost, libraryKey, type LocalProgress } from "./HostContext";
import { pluginCommand, pluginError, releaseMedia, type InstalledPlugin, type PreparedMedia, type PlaybackChoices } from "./client";
import { initialPlaybackSelection, rememberPlaybackSelection, type PlaybackSelection } from "./playbackSelection";
import { usePluginRequests } from "./usePluginRequests";
import PluginPlayer from "./PluginPlayer";
import type { FeedPresentation } from "../components/Feed";
import { useAssetUrls } from "./MediaCards";
import type { Episode, MediaDetail, MediaItem, Page } from "./protocol";
import { Notice } from "./BrowsePages";
import CommentsPanel from "./CommentsPanel";
import MediaInteractions from "./MediaInteractions";
import { pluginProgressReporter } from "./progressReporter";
import SourceSwitcher from "./SourceSwitcher";
import type { SourceStart } from "./sourceMatching";
import ResolverChooser from "./ResolverChooser";

/** Only explicit season/episode identities can suggest alignment. Never infer from index. */
export function alignedEpisode(previous: Episode, episodes: Episode[]) {
  if (previous.episodeNumber === undefined) return undefined;
  const matches = episodes.filter(e => e.episodeNumber === previous.episodeNumber && e.season === previous.season);
  return matches.length === 1 ? matches[0] : undefined;
}
export default function PluginMediaDetail({ plugin, mediaId, onBack, manage, active = true, start, onSwitch, presentation = {}, entryEpisodeId, entryItem }: {
  plugin: InstalledPlugin; mediaId: string; onBack?: () => void; manage: () => void; active?: boolean; presentation?: FeedPresentation; entryEpisodeId?: string; entryItem?: MediaItem;
  start?: SourceStart; onSwitch: (pluginId: string, mediaId: string, start?: SourceStart) => void;
}) {
  const host = useHost(), request = usePluginRequests();
  const [detail, setDetail] = useState<MediaDetail | null>(null), [error, setError] = useState("");
  const [needsDetail, setNeedsDetail] = useState(!entryEpisodeId);
  const [playlist, setPlaylist] = useState(""), [episode, setEpisode] = useState<Episode | null>(null);
  const [media, setMedia] = useState<PreparedMedia | null>(null), [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<PreparedMedia["choices"] | null>(null);
  const [switching, setSwitching] = useState(false), startedFromSource = useRef(false);
  const selection = useRef(initialPlaybackSelection(plugin.meta.id));
  const attempted = useRef(new Set<string>());
  const sequence = useRef(0), position = useRef(0), refreshed = useRef(false), current = useRef<{ ep: Episode; playlistId?: string } | null>(null);
  const detailRef = useRef<MediaItem | null>(detail || entryItem || null), latestHost = useRef(host); detailRef.current = detail || entryItem || null; latestHost.current = host;
  const session = useRef<PreparedMedia | null>(null), lastSave = useRef(0);
  const entry = host.library.find(e => libraryKey(e.pluginId, e.mediaId) === libraryKey(plugin.meta.id, mediaId));
  const canPlay = plugin.enabled && ["ready", "unloaded"].includes(plugin.status);
  const progress = useMemo(() => pluginProgressReporter(plugin.meta.id, mediaId, plugin.methods.includes("progress.report")), [plugin.meta.id, mediaId, plugin.revision]);
  useEffect(() => () => progress.pause(), [progress]);
  const save = async () => {
    const c = current.current, d = detailRef.current, seconds = position.current;
    if (!c || !d) return;
    await pluginCommand("library.put", { pluginId: plugin.meta.id, item: d });
    await pluginCommand("library.progress.set", { pluginId: plugin.meta.id, mediaId, playlistId: c.playlistId, episodeId: c.ep.id, positionSec: seconds, durationSec: c.ep.durationSec });
    await latestHost.current.refreshLibrary();
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    if (!needsDetail) return;
    void request<MediaDetail>("call", { id: plugin.meta.id, method: "media.getDetail", args: { id: mediaId } }).then(d => {
      setDetail(d); setPlaylist(d.playlists[0]?.id || "");
      if (entry?.tracking) void host.put(plugin.meta.id, d).catch(e => setError(pluginError(e)));
    }).catch(e => setError(pluginError(e)));
  }, [plugin.meta.id, mediaId, request, needsDetail]);
  useEffect(() => () => { autoStarted.current=false; startedFromSource.current=false; sequence.current++; if (session.current) releaseMedia(session.current.sessionId); void saveRef.current().catch(() => {}); }, [plugin.meta.id, mediaId]);
  useEffect(() => {
    if (!active || !canPlay) {
      autoStarted.current = false;
      startedFromSource.current = false;
      progress.pause();
      sequence.current++; request.cancelAll();
      if (session.current) releaseMedia(session.current.sessionId);
      session.current = null; setMedia(null);
      void saveRef.current().catch(e => setError(pluginError(e)));
    }
  }, [active, canPlay]);
  const play = async (ep: Episode, reason: "play" | "refresh" | "switch" | "fallback" = "play", listId: string | undefined = playlist || undefined, chosen = selection.current, proposedPosition?: number) => {
    const n = ++sequence.current;
    setBusy(true); setError("");
    if (reason !== "refresh") { await save().catch(() => {}); request.cancelAll(); }
    if (n !== sequence.current) return;
    setEpisode(ep);
    if (session.current) releaseMedia(session.current.sessionId);
    session.current = null; setMedia(null);
    try {
      if (reason === "play") {
        setChoices(null);
        chosen = { ...chosen, streamIndex: 0, resolverStreamIndex: 0 };
        const saved = await request<LocalProgress | null>("library.progress.get", { pluginId: plugin.meta.id, mediaId, playlistId: listId, episodeId: ep.id });
        if (n !== sequence.current) return;
        position.current = saved?.positionSec ?? proposedPosition ?? 0; refreshed.current = false;
        progress.select(ep.id, position.current);
        current.current = { ep, playlistId: listId };
      }
      if (reason === "switch") refreshed.current = false;
      if (reason === "play" || reason === "switch") attempted.current.clear();
      selection.current = chosen;
      const { serverId, ...options } = chosen;
      const r = await request<PreparedMedia>("media.prepare", { id: plugin.meta.id, ...options, args: { mediaId, episodeId: ep.id, playlistId: listId, serverId, reason: reason === "refresh" ? "refresh" : "play", codecs: ["h264"] } });
      if (n !== sequence.current) { releaseMedia(r.sessionId); return; }
      selection.current = rememberPlaybackSelection(r, chosen);
      session.current = r; setMedia(r); setChoices(r.choices);
      void save().catch(e => setError(pluginError(e)));
      return r.choices.resolverRoute;
    } catch (e) {
      if (n !== sequence.current) return; setError(pluginError(e));
      const available = (e as { playbackChoices?: PreparedMedia["choices"] })?.playbackChoices;
      if (available) setChoices(available);
    } finally { if (n === sequence.current) setBusy(false); }
  };
  useEffect(() => {
    if (!start || !detail || !active || !canPlay || startedFromSource.current) return;
    startedFromSource.current = true;
    let live = true;
    void (async () => {
      let list = detail.playlists.find(p => p.id === start.playlistId);
      const cursors = new Set<string>();
      while (list && !list.episodes.some(e => e.id === start.episodeId) && list.next && !cursors.has(list.next) && plugin.methods.includes("media.listEpisodes")) {
        cursors.add(list.next);
        const page = await request<Page<Episode>>("call", { id: plugin.meta.id, method: "media.listEpisodes", args: { mediaId, playlistId: list.id, cursor: list.next, limit: 100 } });
        if (!live) return;
        const ids = new Set(list.episodes.map(e => e.id));
        list = { ...list, next: page.next, episodes: [...list.episodes, ...page.items.filter(e => { if (ids.has(e.id)) return false; ids.add(e.id); return true; })] };
      }
      if (!live) return;
      const ep = list?.episodes.find(e => e.id === start.episodeId);
      if (!list || !ep || ep.locked) { setError("候选分集已变化或不可播放，请重新选择分集。"); return; }
      const loadedList = list;
      setDetail(old => old && ({ ...old, playlists: old.playlists.map(p => p.id === loadedList.id ? loadedList : p) }));
      setPlaylist(list.id); void play(ep, "play", list.id, selection.current, start.positionSec);
    })().catch(e => { if (live) setError(pluginError(e)); });
    return () => { live = false; };
  }, [start, !!detail, active, canPlay]);
  const autoStarted = useRef(false);
  useEffect(() => {
    if ((!detail && !entryEpisodeId) || start || !active || !canPlay || autoStarted.current) return;
    autoStarted.current = true;
    if (entryEpisodeId) { void play({ id: entryEpisodeId, index: 1 }, "play", undefined); return; }
    if (!detail) return;
    let live = true;
    void (async () => {
      const resume = entry?.lastProgress;
      let list = detail.playlists.find(p => p.id === resume?.playlistId) || detail.playlists[0];
      if (!list) { setError("暂无可播放分集"); return; }
      const wanted = entryEpisodeId || resume?.episodeId;
      const cursors = new Set<string>();
      while ((!list.episodes.length || (wanted && !list.episodes.some(e => e.id === wanted))) && list.next && !cursors.has(list.next) && plugin.methods.includes("media.listEpisodes")) {
        cursors.add(list.next);
        const page = await request<Page<Episode>>("call", {id:plugin.meta.id,method:"media.listEpisodes",args:{mediaId,playlistId:list.id,cursor:list.next,limit:100}});
        if (!live) return;
        const known = new Set(list.episodes.map(e=>e.id));
        list={...list,next:page.next,episodes:[...list.episodes,...page.items.filter(e=>!known.has(e.id))]};
      }
      if (!live) return;
      const loaded = list;
      setDetail(old=>old && ({...old,playlists:old.playlists.map(p=>p.id===loaded.id?loaded:p)}));
      const first=list.episodes.find(e=>e.id===wanted) || list.episodes[0];
      setPlaylist(list.id);
      if (!first || first.locked) { setError(first?.lockReason || "请选择可播放的分集"); return; }
      void play(first,"play",list.id);
    })().catch(e=>{if(live)setError(pluginError(e));});
    return()=>{live=false;};
  }, [!!detail, start, active, canPlay]);
  const selectPlayback = (update: Partial<PlaybackSelection>) => {
    const c = current.current; if (c) void play(c.ep, "switch", c.playlistId, { ...selection.current, ...update });
  };
  const failed = () => {
    const c = current.current; if (!c) return;
    if (!refreshed.current) { refreshed.current = true; void play(c.ep, "refresh", c.playlistId); }
    else {
      const key = (s: PlaybackSelection) => JSON.stringify([s.serverId, s.streamIndex, s.resolverId, s.resolverStreamIndex]);
      attempted.current.add(key(selection.current));
      const alternatives: PlaybackSelection[] = [];
      if (choices?.resolver) for (const stream of choices.resolver.streams) alternatives.push({ ...selection.current, resolverStreamIndex: stream.index });
      if (choices) for (const stream of choices.source.streams) {
        if (stream.index !== selection.current.streamIndex) alternatives.push({ ...selection.current, streamIndex: stream.index, resolverStreamIndex: 0 });
      }
      const next = host.prefs.playbackFallback && alternatives.find(s => !attempted.current.has(key(s)));
      if (next) { attempted.current.add(key(next)); void play(c.ep, "fallback", c.playlistId, next); }
      else setError("播放失败，已尝试可用播放流，可手动切换线路或重试。");
    }
  };
  const currentList = detail?.playlists.find(p => p.id === playlist);
  const more = async () => {
    if (!currentList?.next) return; setBusy(true);
    try {
      const result = await request<Page<Episode>>("call", { id: plugin.meta.id, method: "media.listEpisodes", args: { mediaId, playlistId: playlist, cursor: currentList.next, limit: 100 } });
      setDetail(d => d ? { ...d, playlists: d.playlists.map(p => p.id === playlist ? { ...p, episodes: [...p.episodes, ...result.items.filter(e => !p.episodes.some(old => old.id === e.id))], next: result.next } : p) } : d);
    } catch (e) { setError(pluginError(e)); } finally { setBusy(false); }
  };
  const chooseList = (id: string) => {
    setPlaylist(id); const old = current.current?.ep, list = detail?.playlists.find(p => p.id === id);
    const aligned = old && list && alignedEpisode(old, list.episodes);
    if (aligned) { setEpisode(aligned); setError("已按季集编号定位，请选择分集播放。"); }
    else { setEpisode(null); if (old) setError("无法唯一对齐季集编号，请重新选集。"); }
  };
  const resume = entry?.lastProgress;
  const cover = detail?.cover || entryItem?.cover;
  const poster = useAssetUrls(plugin.meta.id, cover ? [cover] : [])[0];
  const nextEpisode = currentList?.episodes[(currentList?.episodes.findIndex(e=>e.id===episode?.id) ?? -1)+1];
  const refresh = () => { const c=current.current; if(c){refreshed.current=false;attempted.current.clear();void play(c.ep,"refresh",c.playlistId);} };
  const episodesPanel = <><div className="hpp-playlists">{detail?.playlists.map(p=><button key={p.id} aria-pressed={p.id===playlist} className={p.id===playlist?"selected":""} disabled={busy} onClick={()=>chooseList(p.id)}>{p.label||p.id}</button>)}</div>
    {[...new Set(currentList?.episodes.map(e=>e.season)||[])].map(season=><section key={season??"none"}>{season!==undefined&&<h3>{detail?.seasons?.find(s=>s.number===season)?.label||`第 ${season} 季`}</h3>}<div className="hpp-episodes">{currentList?.episodes.filter(e=>e.season===season).map(ep=><button key={ep.id} title={ep.lockReason||ep.title} className={episode?.id===ep.id?"selected":""} aria-pressed={episode?.id===ep.id} disabled={busy||ep.locked||!canPlay} onClick={()=>void play(ep)}>{ep.label||`第 ${ep.index} 集`}</button>)}</div></section>)}
    {currentList?.next && plugin.methods.includes("media.listEpisodes") && <button disabled={busy} onClick={()=>void more()}>更多分集</button>}</>;
  const playbackPanel=<><Notice error={error}/><div className="hpp-playback-options" aria-label="播放选择">{choices && <>
    <PlaybackOptions stage="源" choices={choices.source} disabled={busy} onServer={serverId=>selectPlayback({serverId:serverId||undefined,streamIndex:0,resolverStreamIndex:0})} onStream={streamIndex=>selectPlayback({streamIndex,resolverStreamIndex:0})}/>
    {choices.resolver && <PlaybackOptions stage="解析器" choices={choices.resolver} disabled={busy} onServer={serverId=>selectPlayback({resolverServers:{...selection.current.resolverServers,[choices.resolver!.pluginId]:serverId},resolverStreamIndex:0})} onStream={resolverStreamIndex=>selectPlayback({resolverStreamIndex})}/>}</>}
    <button disabled={busy||!active} onClick={refresh}>刷新播放</button><button disabled={busy||!active} onClick={()=>selectPlayback({serverId:undefined,resolverId:undefined,streamIndex:0,resolverStreamIndex:0,resolverServers:{}})}>使用默认播放选择</button>
    <button disabled={busy||!detail} onClick={()=>setSwitching(true)}>换源</button>
    {choices?.resolverRoute && <ResolverChooser key={choices.resolverRoute.host} route={choices.resolverRoute} busy={busy||!active} select={(resolverId,resolverHost)=>{const c=current.current;return c?play(c.ep,"switch",c.playlistId,{...selection.current,resolverId,resolverHost,resolverStreamIndex:0}):Promise.resolve(undefined);}}/>}</div></>;
  const detailPanel=detail?<><div className="legacy-detail-summary">{poster&&<img src={poster} alt=""/>}<div><h2>{detail.title}</h2><p>{plugin.meta.name}</p>{detail.score!==undefined&&<strong>{detail.score.toFixed(1)} 分</strong>}<p>{detail.episodeCount||currentList?.episodes.length||0} 集</p></div></div><h3>简介</h3><p className="hpp-description">{detail.description||"暂无简介"}</p>
    <button onClick={()=>void host.put(plugin.meta.id,detail,{tracking:!entry?.tracking}).catch(e=>setError(pluginError(e)))}>{entry?.tracking?"取消追更":"追更"}</button>
    {resume&&<button disabled={busy} onClick={()=>{const list=detail.playlists.find(p=>p.id===resume.playlistId),ep=list?.episodes.find(e=>e.id===resume.episodeId);if(list&&ep){setPlaylist(list.id);void play(ep,"play",list.id);}else setError("上次分集暂未加载，请加载对应播放列表后选集。");}}>继续观看 · {Math.floor(resume.positionSec)} 秒</button>}
    {active&&<MediaInteractions plugin={plugin} detail={detail}/>}<button onClick={manage}>管理此插件</button></>:<p>{error||"正在读取作品…"}</p>;
  return <div className="legacy-media-page">
    <PluginPlayer {...presentation} media={active&&canPlay?media:null} active={active} position={position.current} error={error} onRetry={refresh}
      onPanelChange={panel=>{if(panel==='detail'||panel==='episodes')setNeedsDetail(true);}}
      title={detail?.title||presentation.title} author={detail?.author?.name||plugin.meta.name} description={detail?.description} score={detail?.score} poster={poster}
      episodeLabel={episode?.label||String(episode?.episodeNumber??episode?.index??1)} episodeCount={detail?.episodeCount||currentList?.episodes.length}
      social={detail&&active?<MediaInteractions compact plugin={plugin} detail={detail}/>:undefined}
      onBack={onBack} favorite={!!entry?.favorite} onFavorite={detail||entryItem?()=>void host.put(plugin.meta.id,(detail||entryItem)!,{favorite:!entry?.favorite}).catch(e=>setError(pluginError(e))):undefined}
      onNextEpisode={nextEpisode&&!nextEpisode.locked?()=>void play(nextEpisode):undefined}
      panels={{detail:detailPanel,episodes:episodesPanel,playback:playbackPanel,comments:plugin.methods.includes("comments.list")?<CommentsPanel embedded plugin={plugin} mediaId={mediaId} episodeId={current.current?.ep.id}/>:undefined}}
      onPosition={(t,duration)=>{position.current=t;progress.update(t,duration);if(Date.now()-lastSave.current>5000){lastSave.current=Date.now();void save().catch(e=>setError(pluginError(e)));}}}
      onPlaying={progress.playing} onStopped={()=>{progress.pause();void save().catch(e=>setError(pluginError(e)));}}
      onEnded={()=>{progress.end();void save().catch(()=>{});if(host.prefs.autoNext){if(nextEpisode&&!nextEpisode.locked)void play(nextEpisode);else presentation.onNext?.();}}} onFailure={failed}/>
    {switching&&detail&&active&&<SourceSwitcher plugin={plugin} detail={detail} previousEpisode={current.current?.ep} getPosition={()=>position.current} beforeSwitch={save} onConfirm={onSwitch} onClose={()=>setSwitching(false)}/>}
  </div>;
}

function PlaybackOptions({ stage, choices, disabled, onServer, onStream }: {
  stage: string; choices: PlaybackChoices; disabled: boolean; onServer: (id: string) => void; onStream: (index: number) => void;
}) {
  return <div>
    {choices.servers.length > 1 && <label>{stage}播放线路<select aria-label={`${stage}播放线路`} disabled={disabled} value={choices.serverId || ""} onChange={e => onServer(e.target.value)}>
      <option value="">插件默认</option>{choices.servers.map(server => <option key={server.id} value={server.id}>{server.label || server.id}</option>)}
    </select></label>}
    {choices.streams.length > 1 && <label>{stage}清晰度 / 播放流<select aria-label={`${stage}播放流`} disabled={disabled} value={choices.streamIndex} onChange={e => onStream(Number(e.target.value))}>
      {choices.streams.map(stream => <option key={stream.index} value={stream.index}>{stream.label || [stream.height && `${stream.height}p`, stream.codec, stream.format || stream.kind].filter(Boolean).join(" · ") || `播放流 ${stream.index + 1}`}</option>)}
    </select></label>}
  </div>;
}
