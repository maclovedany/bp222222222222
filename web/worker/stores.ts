// 공공데이터포털 소상공인 상가(상권)정보: 다각형 안의 음식 업종 상가를 가져온다.
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

const ENDPOINT = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInPolygon";
const FOOD_CODE = "I2"; // 업종 대분류: 음식
const MAX_VERTICES = 200;

export type Store = {
  bizesId: string;
  bizesNm: string;
  brchNm?: string;
  indsLclsNm?: string;
  indsMclsNm?: string;
  indsSclsNm?: string;
  rdnmAdr?: string;
  lnoAdr?: string;
  lon: string | number;
  lat: string | number;
};

// API는 WKT 단일 폴리곤만 받으므로 바깥 고리만, 점 수를 줄여 보낸다. 정확한 판정은 받은 뒤 다시 한다.
function toWkt(ring: Position[]): string {
  let poly = turf.polygon([ring]);
  for (let tol = 0.00002; poly.geometry.coordinates[0].length > MAX_VERTICES; tol *= 2) {
    poly = turf.simplify(turf.polygon([ring]), { tolerance: tol, highQuality: true });
  }
  return "POLYGON((" + poly.geometry.coordinates[0].map(([x, y]) => `${x} ${y}`).join(",") + "))";
}

async function fetchPolygon(wkt: string): Promise<Store[]> {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error("DATA_GO_KR_KEY가 설정되지 않았습니다");
  const all: Store[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      serviceKey: key,
      pageNo: String(page),
      numOfRows: "1000",
      key: wkt,
      indsLclsCd: FOOD_CODE,
      type: "json",
    });
    const res = await fetch(`${ENDPOINT}?${params}`);
    const text = await res.text();
    if (!res.ok) throw new Error(`상가정보 API ${res.status}: ${text.slice(0, 300)}`);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`상가정보 API 응답이 JSON이 아닙니다(인증키 확인): ${text.slice(0, 300)}`);
    }
    const header = data.header ?? data.response?.header;
    const body = data.body ?? data.response?.body;
    if (header?.resultCode === "03") break; // 데이터 없음
    if (header?.resultCode && header.resultCode !== "00") throw new Error(`상가정보 API ${header.resultCode} ${header.resultMsg}`);
    const items: Store[] = body?.items ?? [];
    all.push(...items);
    if (items.length < 1000 || all.length >= Number(body?.totalCount ?? 0)) break;
  }
  return all;
}

export async function storesInArea(area: Feature<Polygon | MultiPolygon>): Promise<Store[]> {
  const rings = area.geometry.type === "Polygon" ? [area.geometry.coordinates[0]] : area.geometry.coordinates.map((p) => p[0]);
  const byId = new Map<string, Store>();
  for (const ring of rings) {
    for (const s of await fetchPolygon(toWkt(ring))) byId.set(s.bizesId, s);
  }
  return [...byId.values()].filter((s) => turf.booleanPointInPolygon([Number(s.lon), Number(s.lat)], area));
}
