import { NextResponse } from "next/server";
import { parseNaturalQuery } from "@/lib/gemini";
import { serverDb } from "@/lib/supabase";

// "역삼동", "을지로", "강남역"처럼 구획 이름 한 단어면 AI 없이 바로 쓴다.
const PLAIN_AREA = /^[가-힣0-9·.]{2,15}$/;

export async function POST(req: Request) {
  const { q } = (await req.json()) as { q?: string };
  const query = (q ?? "").trim();
  if (!query) return NextResponse.json({ error: "검색어를 입력하세요" }, { status: 400 });

  let area = query;
  let category: string | null = null;
  if (!PLAIN_AREA.test(query)) {
    try {
      ({ area, category } = await parseNaturalQuery(query));
    } catch (e) {
      return NextResponse.json({ error: `검색어를 이해하지 못했습니다: ${e instanceof Error ? e.message : e}` }, { status: 400 });
    }
  }

  const db = serverDb();
  const { error: insErr } = await db.from("areas").upsert({ name: area }, { onConflict: "name", ignoreDuplicates: true });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  // 실패했던 구획은 다시 수집 대기열에 넣는다.
  await db.from("areas").update({ status: "pending", error: null }).eq("name", area).eq("status", "failed");
  const { data, error } = await db.from("areas").select("id,name,status").eq("name", area).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ area: data, category });
}
