import { NextResponse } from "next/server";
import { serverDb } from "@/lib/supabase";

export async function POST(req: Request) {
  const { restaurantId, status } = (await req.json()) as { restaurantId?: string; status?: string };
  if (!restaurantId || (status !== "yes" && status !== "no")) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const { error } = await serverDb().rpc("cast_vote", { p_restaurant_id: restaurantId, p_status: status });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
