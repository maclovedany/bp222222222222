// Gemini로 업종(소분류)별 "식당인지"를 판정한다. 결과는 category_filter 테이블에 캐시해 같은 업종은 다시 묻지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiJson } from "../src/lib/gemini";

export async function restaurantCategories(db: SupabaseClient, categories: string[]): Promise<Set<string>> {
  const unique = [...new Set(categories.filter(Boolean))];
  const { data: cached, error } = await db.from("category_filter").select("category_small,is_restaurant").in("category_small", unique);
  if (error) throw error;
  const verdict = new Map<string, boolean>(cached.map((r) => [r.category_small, r.is_restaurant]));

  const unknown = unique.filter((c) => !verdict.has(c));
  if (unknown.length) {
    const answer = await geminiJson<Record<string, boolean>>(
      `다음은 한국 상가 업종 이름 목록이다. 각 업종이 '식당'(식사를 파는 음식점)이면 true, 아니면 false로 판정하라.
카페·커피·음료·제과·제빵·아이스크림·주점·호프·술집·편의점·식료품 판매는 식당이 아니다(false).
한식·중식·일식·양식·분식·치킨·피자·패스트푸드·고기구이·국밥·뷔페 등 식사를 파는 곳은 true.
업종 이름을 키로, true/false를 값으로 하는 JSON 객체 하나만 출력하라.

${JSON.stringify(unknown)}`,
    );
    const rows = unknown.map((c) => ({ category_small: c, is_restaurant: answer[c] === true }));
    const { error: upErr } = await db.from("category_filter").upsert(rows);
    if (upErr) throw upErr;
    rows.forEach((r) => verdict.set(r.category_small, r.is_restaurant));
  }
  return new Set([...verdict].filter(([, ok]) => ok).map(([c]) => c));
}
