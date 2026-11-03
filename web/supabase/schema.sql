-- 비플페이 식당 지도 스키마. Supabase SQL Editor에 그대로 붙여 실행한다.

-- 구획: 사용자가 입력한 이름 하나당 한 줄. 웹앱이 pending으로 만들고 Mac 워커가 채운다.
create table if not exists areas (
  id bigint generated always as identity primary key,
  name text not null unique,
  status text not null default 'pending' check (status in ('pending', 'collecting', 'ready', 'failed')),
  kind text check (kind in ('dong', 'road', 'place')),
  geojson jsonb,
  center_lat double precision,
  center_lng double precision,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 식당: 소상공인 상가정보의 상가업소번호(bizesId)가 키. 비플페이 상태는 식당에 하나만 둔다(최신 응답).
create table if not exists restaurants (
  id text primary key,
  name text not null,
  category_mid text,
  category_small text,
  address text,
  lat double precision not null,
  lng double precision not null,
  bpay_status text check (bpay_status in ('yes', 'no')),
  bpay_updated_at timestamptz
);

-- 구획과 식당은 다대다(한 식당이 도로 띠와 동에 함께 속할 수 있다).
create table if not exists area_restaurants (
  area_id bigint not null references areas(id) on delete cascade,
  restaurant_id text not null references restaurants(id) on delete cascade,
  primary key (area_id, restaurant_id)
);

-- 응답 기록. 로그인이 없으므로 잘못된 변경을 되돌릴 근거로 전부 남긴다.
create table if not exists votes (
  id bigint generated always as identity primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  status text not null check (status in ('yes', 'no')),
  created_at timestamptz not null default now()
);

-- 업종(소분류)별 Gemini 판정 캐시: 식당이면 true.
create table if not exists category_filter (
  category_small text primary key,
  is_restaurant boolean not null
);

-- 누구나 읽기만 가능. 쓰기는 서버(service role)만 한다.
alter table areas enable row level security;
alter table restaurants enable row level security;
alter table area_restaurants enable row level security;
alter table votes enable row level security;
alter table category_filter enable row level security;

drop policy if exists "read areas" on areas;
create policy "read areas" on areas for select using (true);
drop policy if exists "read restaurants" on restaurants;
create policy "read restaurants" on restaurants for select using (true);
drop policy if exists "read area_restaurants" on area_restaurants;
create policy "read area_restaurants" on area_restaurants for select using (true);

-- 투표 한 번에 식당 상태 갱신 + 기록 추가.
create or replace function cast_vote(p_restaurant_id text, p_status text)
returns void language sql as $$
  insert into votes (restaurant_id, status) values (p_restaurant_id, p_status);
  update restaurants set bpay_status = p_status, bpay_updated_at = now() where id = p_restaurant_id;
$$;

-- 지도에 실시간 반영할 테이블.
alter publication supabase_realtime add table restaurants;
alter publication supabase_realtime add table areas;
