import { IHeartF, IPlayF } from "../icons";
import { useAssetUrls } from "./MediaCards";
import type { SearchHit } from "./searchModel";

const count = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, "")}万` : String(n);
type Poster = { hit: SearchHit; group: SearchHit[]; index: number };

// Reuses the historical WaterfallCard presentation; each plugin prepares its own protected images in a batch.
function SourcePosters({ pluginId, posters, name, open }: { pluginId: string; posters: Poster[]; name: string; open: (group: SearchHit[]) => void }) {
  const urls = useAssetUrls(pluginId, posters.flatMap(p => p.hit.item.cover ? [p.hit.item.cover] : []));
  let imageIndex = 0;
  return <>{posters.map(({ hit: { item: v }, group, index }) => {
    const cover = v.cover ? urls[imageIndex++] : undefined;
    const badge = v.badge || (v.status === "finished" ? "已完结" : v.episodeCount ? `更新至${v.episodeCount}集` : "");
    const plays = v.stats?.plays ?? v.stats?.hot;
    const sources = new Set(group.map(h => h.pluginId)).size;
    return <button key={v.id} onClick={() => open(group)} style={{ order: index, paddingTop: "132%" }}
      className="legacy-search-poster relative w-full overflow-hidden text-left bg-s1 elev-1 pressable block rounded-(--r-sm)">
      {cover ? <img src={cover} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>
        : <span className="absolute inset-0 grid place-items-center text-mut text-3xl">{v.title.slice(0, 2)}</span>}
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/30 to-transparent"/>
      {badge && <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold brand-grad elev-1">{badge}</span>}
      {plays !== undefined && <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/45 backdrop-blur-sm text-[9px] font-semibold text-white/90"><IPlayF size={9}/>{count(plays)}</span>}
      <div className="absolute inset-x-0 bottom-0 p-2">
        <div className="text-[11.5px] font-medium text-white leading-snug clamp-2 tsh">{v.title}</div>
        <div className="flex items-center justify-between gap-1 mt-1">
          <span className="text-[9.5px] text-white/65 truncate">{v.author?.name || name}{sources > 1 ? ` · ${sources} 个来源` : ""}</span>
          {v.stats?.likes !== undefined && <span className="flex shrink-0 items-center gap-0.5 text-[9.5px] text-white/75"><IHeartF size={10}/>{count(v.stats.likes)}</span>}
        </div>
      </div>
    </button>;
  })}</>;
}

export default function SearchPosters({ groups, names, open }: { groups: SearchHit[][]; names: Record<string, string>; open: (group: SearchHit[]) => void }) {
  const batches = new Map<string, Poster[]>();
  groups.forEach((group, index) => {
    const hit = group.find(h => h.item.cover) || group[0];
    batches.set(hit.pluginId, [...batches.get(hit.pluginId) || [], { hit, group, index }]);
  });
  return <div className="legacy-search-grid">{[...batches].map(([pluginId, posters]) => <SourcePosters key={pluginId} pluginId={pluginId} posters={posters} name={names[pluginId]} open={open}/>)}</div>;
}
