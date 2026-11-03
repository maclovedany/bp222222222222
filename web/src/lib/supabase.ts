import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 브라우저용: 읽기와 실시간 구독만 한다. 빌드 중 환경변수 없이 import돼도 깨지지 않게 처음 쓸 때 만든다.
let browser: SupabaseClient | null = null;
export function browserDb() {
  browser ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return browser;
}

// 서버(API 라우트) 전용: 쓰기는 이것으로만 한다.
export function serverDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export type Area = {
  id: number;
  name: string;
  status: "pending" | "collecting" | "ready" | "failed";
  kind: "dong" | "road" | "place" | null;
  geojson: GeoJSON.Feature | null;
  center_lat: number | null;
  center_lng: number | null;
  error: string | null;
};

export type Restaurant = {
  id: string;
  name: string;
  category_mid: string | null;
  category_small: string | null;
  address: string | null;
  lat: number;
  lng: number;
  bpay_status: "yes" | "no" | null;
  bpay_updated_at: string | null;
};
