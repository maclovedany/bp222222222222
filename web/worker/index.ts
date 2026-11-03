// Mac에서 상주하는 수집 워커. 웹앱이 등록한 pending 구획을 하나씩 집어 폴리곤과 식당을 채운다.
//   npm run worker
import { createClient } from "@supabase/supabase-js";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { naverDongPolygon } from "./aside";
import { osmPlaceArea, osmRoadArea, toSingleArea } from "./osm";
import { storesInArea } from "./stores";
import { restaurantCategories } from "./filter";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

type Kind = "dong" | "road" | "place";

// 동 이름은 네이버 폴리곤, 도로명은 OSM 도로 띠, 나머지(지명)는 반경 원.
export async function resolveArea(name: string): Promise<{ kind: Kind; area: Feature<Polygon | MultiPolygon> }> {
  const naver = await naverDongPolygon(name);
  if (naver) return { kind: "dong", area: toSingleArea(naver) };
  if (/(로|길)$/.test(name)) {
    const road = await osmRoadArea(name);
    if (road) return { kind: "road", area: road };
  }
  const place = await osmPlaceArea(name);
  if (place) return { kind: "place", area: place };
  throw new Error(`'${name}'에 해당하는 구획을 찾지 못했습니다`);
}

async function collect(id: number, name: string) {
  const { kind, area } = await resolveArea(name);
  const [lng, lat] = turf.centroid(area).geometry.coordinates;
  console.log(`[${name}] 구획=${kind}, 상가 조회 중`);

  const stores = await storesInArea(area);
  const ok = await restaurantCategories(db, stores.map((s) => s.indsSclsNm ?? ""));
  const rows = stores
    .filter((s) => ok.has(s.indsSclsNm ?? ""))
    .map((s) => ({
      id: s.bizesId,
      name: s.brchNm ? `${s.bizesNm} ${s.brchNm}` : s.bizesNm,
      category_mid: s.indsMclsNm ?? null,
      category_small: s.indsSclsNm ?? null,
      address: s.rdnmAdr || s.lnoAdr || null,
      lat: Number(s.lat),
      lng: Number(s.lon),
    }));
  console.log(`[${name}] 음식 업종 ${stores.length}곳 중 식당 ${rows.length}곳`);

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    // bpay_status 열은 보내지 않으므로 기존 응답은 유지된다.
    const { error: e1 } = await db.from("restaurants").upsert(chunk);
    if (e1) throw e1;
    const { error: e2 } = await db
      .from("area_restaurants")
      .upsert(chunk.map((r) => ({ area_id: id, restaurant_id: r.id })), { ignoreDuplicates: true });
    if (e2) throw e2;
  }

  const { error } = await db
    .from("areas")
    .update({ status: "ready", kind, geojson: area, center_lat: lat, center_lng: lng, error: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function nextJob(): Promise<{ id: number; name: string } | null> {
  const { data } = await db.from("areas").select("id,name").eq("status", "pending").order("created_at").limit(1);
  const job = data?.[0];
  if (!job) return null;
  // 다른 워커와 겹치지 않게 pending일 때만 가져간다.
  const { data: claimed } = await db
    .from("areas")
    .update({ status: "collecting", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id");
  return claimed?.length ? job : null;
}

async function main() {
  // 지난번에 중간에 꺼진 작업은 다시 대기열로.
  await db.from("areas").update({ status: "pending" }).eq("status", "collecting");
  console.log("수집 워커 시작. 새 구획을 기다립니다.");
  for (;;) {
    const job = await nextJob();
    if (!job) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    console.log(`[${job.name}] 수집 시작`);
    try {
      await collect(job.id, job.name);
      console.log(`[${job.name}] 완료`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${job.name}] 실패: ${msg}`);
      await db.from("areas").update({ status: "failed", error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", job.id);
    }
  }
}

if (process.argv[1]?.endsWith("index.ts")) main();
