"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { browserDb, type Area, type Restaurant } from "@/lib/supabase";

type Status = Restaurant["bpay_status"];

const STATUS_TEXT: Record<string, string> = {
  pending: "수집 대기 중입니다. 수집 컴퓨터가 켜져 있으면 곧 시작됩니다.",
  collecting: "구획 경계와 식당 정보를 수집하는 중입니다…",
};

function pinIcon(status: Status) {
  const cls = status === "yes" ? "pin pin-yes" : status === "no" ? "pin pin-no" : "pin";
  return L.divIcon({ className: "", html: `<div class="${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}

function stateText(status: Status) {
  return status === "yes" ? "비플페이 가능" : status === "no" ? "비플페이 불가능" : "아직 확인 안 됨";
}

function matches(r: Restaurant, category: string | null) {
  if (!category) return true;
  return [r.category_mid, r.category_small, r.name].some((t) => t?.includes(category));
}

async function loadRestaurants(areaId: number): Promise<Restaurant[]> {
  const out: Restaurant[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await browserDb()
      .from("area_restaurants")
      .select("restaurants(*)")
      .eq("area_id", areaId)
      .range(from, from + 999);
    if (error) throw error;
    out.push(...data.map((d) => d.restaurants as unknown as Restaurant));
    if (data.length < 1000) return out;
  }
}

export default function MapView() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const areaLayer = useRef<L.GeoJSON | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; data: Restaurant }>());

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [counts, setCounts] = useState({ total: 0, yes: 0, no: 0 });

  const refreshCounts = useCallback(() => {
    let total = 0, yes = 0, no = 0;
    markers.current.forEach(({ data }) => {
      if (!matches(data, category)) return;
      total++;
      if (data.bpay_status === "yes") yes++;
      if (data.bpay_status === "no") no++;
    });
    setCounts({ total, yes, no });
  }, [category]);

  const applyStatus = useCallback((id: string, status: Status) => {
    const entry = markers.current.get(id);
    if (!entry) return;
    entry.data = { ...entry.data, bpay_status: status };
    entry.marker.setIcon(pinIcon(status));
    // 팝업 내용을 통째로 바꾸면 클릭 중이던 버튼이 문서에서 빠져 Leaflet이 바깥 클릭으로 보고 팝업을 닫는다. 글자만 고친다.
    const stateEl = entry.marker.getPopup()?.getElement()?.querySelector(".popup-state");
    if (stateEl) stateEl.textContent = stateText(status);
  }, []);

  const vote = useCallback(async (id: string, status: "yes" | "no") => {
    const before = markers.current.get(id)?.data.bpay_status ?? null;
    applyStatus(id, status);
    refreshCounts();
    const res = await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ restaurantId: id, status }) });
    if (!res.ok) {
      applyStatus(id, before);
      refreshCounts();
      setMessage("저장하지 못했습니다. 잠시 후 다시 시도하세요.");
    }
  }, [applyStatus, refreshCounts]);

  // 팝업은 열 때마다 최신 상태로 새로 만든다.
  const popupRef = useRef<(r: Restaurant) => HTMLElement>(() => document.createElement("div"));
  popupRef.current = (r: Restaurant) => {
    const el = document.createElement("div");
    el.className = "popup";
    el.innerHTML = `<strong></strong><div class="popup-cat"></div><div class="popup-addr"></div><div class="popup-state"></div>
      <div class="popup-btns"><button data-s="yes" class="btn-yes">비플페이 가능</button><button data-s="no" class="btn-no">불가능</button></div>`;
    el.querySelector("strong")!.textContent = r.name;
    el.querySelector(".popup-cat")!.textContent = [r.category_mid, r.category_small].filter(Boolean).join(" · ");
    el.querySelector(".popup-addr")!.textContent = r.address ?? "";
    el.querySelector(".popup-state")!.textContent = stateText(r.bpay_status);
    el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => vote(r.id, b.dataset.s as "yes" | "no")));
    return el;
  };
  function popupFor(r: Restaurant) {
    return popupRef.current(r);
  }

  // 지도 초기화
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    const m = L.map(mapEl.current, { zoomControl: false }).setView([35.8693, 128.5963], 16); // 대구 동성로
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    markerLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // 다른 사용자의 응답을 실시간 반영
  useEffect(() => {
    const ch = browserDb()
      .channel("restaurants")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "restaurants" }, (p) => {
        const r = p.new as Restaurant;
        applyStatus(r.id, r.bpay_status);
        refreshCounts();
      })
      .subscribe();
    return () => {
      browserDb().removeChannel(ch);
    };
  }, [applyStatus, refreshCounts]);

  // 선택한 구획의 수집 상태를 지켜보다가 준비되면 그린다.
  useEffect(() => {
    if (!area || area.status === "ready" || area.status === "failed") return;
    const t = setInterval(async () => {
      const { data } = await browserDb().from("areas").select("*").eq("id", area.id).single();
      if (data && data.status !== area.status) setArea(data as Area);
    }, 3000);
    return () => clearInterval(t);
  }, [area]);

  useEffect(() => {
    if (!area || area.status !== "ready" || !map.current) return;
    let cancelled = false;
    (async () => {
      areaLayer.current?.remove();
      markerLayer.current!.clearLayers();
      markers.current.clear();
      if (area.geojson) {
        areaLayer.current = L.geoJSON(area.geojson, { style: { color: "#2563eb", weight: 2, fillOpacity: 0.06 } }).addTo(map.current!);
        map.current!.fitBounds(areaLayer.current.getBounds(), { padding: [24, 24] });
      }
      const list = await loadRestaurants(area.id);
      if (cancelled) return;
      for (const r of list) {
        const marker = L.marker([r.lat, r.lng], { icon: pinIcon(r.bpay_status), title: r.name });
        const entry = { marker, data: r };
        marker.bindPopup(() => popupFor(entry.data), { minWidth: 220, autoPanPaddingTopLeft: [16, 150] }); // 검색창 아래로 보이게
        markers.current.set(r.id, entry);
      }
      setMessage(list.length ? null : "이 구획에서 식당을 찾지 못했습니다.");
      showFiltered();
    })().catch((e) => setMessage(`식당을 불러오지 못했습니다: ${e.message}`));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area?.id, area?.status]);

  function showFiltered() {
    const layer = markerLayer.current;
    if (!layer) return;
    layer.clearLayers();
    markers.current.forEach(({ marker, data }) => {
      if (matches(data, category)) layer.addLayer(marker);
    });
    refreshCounts();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(showFiltered, [category]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: query }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setCategory(json.category);
      const { data } = await browserDb().from("areas").select("*").eq("id", json.area.id).single();
      setArea(data as Area);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const statusText = area?.status === "failed" ? `수집에 실패했습니다: ${area.error ?? ""} (다시 검색하면 재시도합니다)` : area ? STATUS_TEXT[area.status] : null;

  return (
    <div className="app">
      <div ref={mapEl} className="map" />
      <div className="panel">
        <form onSubmit={onSearch} className="search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="역삼동, 을지로, 강남역 또는 '을지로 근처 한식집'" aria-label="구획 이름 또는 검색 문장" />
          <button disabled={busy}>{busy ? "…" : "검색"}</button>
        </form>
        {area?.status === "ready" && (
          <div className="summary">
            <b>{area.name}</b>
            {category && (
              <button className="chip" onClick={() => setCategory(null)} title="업종 필터 해제">
                {category} ✕
              </button>
            )}
            <span>
              식당 {counts.total} · <span className="dot dot-yes" /> 가능 {counts.yes} · <span className="dot dot-no" /> 불가능 {counts.no}
            </span>
          </div>
        )}
        {(statusText || message) && <div className="notice">{message ?? statusText}</div>}
      </div>
    </div>
  );
}
