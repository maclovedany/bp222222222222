// 네이버가 폴리곤을 주지 않는 도로명·지명의 구획을 오픈스트리트맵으로 만든다(키 불필요).
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson";

const UA = "bplepay-map-worker/1.0";
const ROAD_BUFFER_KM = 0.05; // 도로 양옆 50m
const PLACE_RADIUS_KM = 0.3; // 지명 반경 300m

type OverpassWay = { geometry?: { lat: number; lon: number }[] };

// 같은 이름의 도로가 여러 도시에 있을 수 있어, 서로 2km 안에 이어진 묶음 중 가장 큰 것을 고른다.
function largestCluster(lines: Feature<LineString>[]): Feature<LineString>[] {
  const centers = lines.map((l) => turf.centroid(l));
  const seen = new Set<number>();
  let best: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (seen.has(i)) continue;
    const group = [i];
    seen.add(i);
    for (let g = 0; g < group.length; g++) {
      for (let j = 0; j < lines.length; j++) {
        if (!seen.has(j) && turf.distance(centers[group[g]], centers[j]) < 2) {
          seen.add(j);
          group.push(j);
        }
      }
    }
    if (group.length > best.length) best = group;
  }
  return best.map((i) => lines[i]);
}

// 공개 Overpass 서버는 자주 바빠서(502·504) 예비 서버까지 차례로 시도한다.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

async function overpass(query: string) {
  let last = "";
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
      });
      if (res.ok) return res.json();
      last = `${url} ${res.status}`;
    } catch (e) {
      last = `${url} ${e instanceof Error ? e.message : e}`;
    }
  }
  throw new Error(`Overpass 실패: ${last}`);
}

export async function osmRoadArea(name: string): Promise<Feature<Polygon | MultiPolygon> | null> {
  const query = `[out:json][timeout:60];area["ISO3166-1"="KR"][admin_level=2]->.kr;way["highway"]["name"=${JSON.stringify(name)}](area.kr);out geom;`;
  const ways: OverpassWay[] = (await overpass(query)).elements ?? [];
  const lines = ways
    .filter((w) => (w.geometry?.length ?? 0) >= 2)
    .map((w) => turf.lineString(w.geometry!.map((p) => [p.lon, p.lat])));
  if (!lines.length) return null;
  const buffered = largestCluster(lines).map((l) => turf.buffer(l, ROAD_BUFFER_KM, { units: "kilometers" })!);
  if (buffered.length === 1) return buffered[0];
  return turf.union(turf.featureCollection(buffered));
}

export async function osmPlaceArea(name: string): Promise<Feature<Polygon> | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ko" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const [hit] = (await res.json()) as { lat: string; lon: string }[];
  if (!hit) return null;
  return turf.circle([Number(hit.lon), Number(hit.lat)], PLACE_RADIUS_KM, { steps: 48, units: "kilometers" });
}

// 네이버 FeatureCollection 등 여러 모양을 폴리곤 Feature 하나로 합친다.
export function toSingleArea(fc: FeatureCollection): Feature<Polygon | MultiPolygon> {
  const polys = fc.features.filter(
    (f): f is Feature<Polygon | MultiPolygon> => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
  );
  if (polys.length === 1) return polys[0];
  return turf.union(turf.featureCollection(polys))!;
}
