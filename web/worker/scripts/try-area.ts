// 키 없이 구획 판별만 시험한다: npx tsx worker/scripts/try-area.ts 역삼동 을지로 강남역
import * as turf from "@turf/turf";
import { naverDongPolygon } from "../aside";
import { osmPlaceArea, osmRoadArea, toSingleArea } from "../osm";

(async () => {
for (const name of process.argv.slice(2)) {
  const naver = await naverDongPolygon(name);
  const area = naver ? toSingleArea(naver) : /(로|길)$/.test(name) ? await osmRoadArea(name) : await osmPlaceArea(name);
  const kind = naver ? "dong(naver)" : /(로|길)$/.test(name) ? "road(osm)" : "place(osm)";
  if (!area) { console.log(name, kind, "없음"); continue; }
  console.log(name, kind, area.geometry.type, "면적 km²=", (turf.area(area) / 1e6).toFixed(3), "중심=", turf.centroid(area).geometry.coordinates.map((n) => n.toFixed(5)).join(","));
}
})();
