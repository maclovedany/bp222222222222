# 비플페이 식당 지도

구획 이름(역삼동·을지로·강남역) 또는 문장("을지로 근처 한식집")을 입력하면, 그 구획의 식당을 오픈스트리트맵 위에 표시합니다.
식당을 눌러 **비플페이 가능 / 불가능**을 고르면 모든 사용자 지도에 바로 반영됩니다.

| 표시 | 뜻 |
|---|---|
| 주황 점 | 아직 확인 안 됨 |
| 주황 점 + 형광 테두리 깜빡임 | 비플페이 가능 |
| 회색 점 | 비플페이 불가능 |

마지막 응답이 최종값이고, 모든 응답은 `votes` 테이블에 기록됩니다(로그인 없음).

## 구조

```
[사용자] → [Vercel 웹앱] → Supabase(areas: pending)
                                   ↑ 결과 저장
                    [Mac 수집 워커: npm run worker]
                      ├ 구획 경계: Aside로 네이버지도 동 폴리곤
                      │            (도로명은 OSM 도로 양옆 50m, 지명은 반경 300m)
                      ├ 식당 목록: 공공데이터포털 소상공인 상가정보(음식 업종)
                      └ 업종 필터: Gemini가 카페·주점 등 식당 아닌 업종 제외
```

- 한 번 수집한 구획은 DB에서 바로 뜹니다. **처음 검색하는 구획은 Mac 워커가 켜져 있어야** 수집됩니다.
- 자연어 검색("○○ 근처 한식집")은 Vercel 서버에서 Gemini로 구획과 음식 종류를 나눕니다. 구획 이름 한 단어는 AI 없이 바로 처리합니다.

## 처음 설정

1. **Supabase**: 새 프로젝트를 만들고 SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. **키 준비**: `.env.example`을 `.env.local`로 복사해 채웁니다.
   - 공공데이터포털에서 "소상공인시장진흥공단_상가(상권)정보" 활용신청 → 일반 인증키(**Decoding**)
   - Google AI Studio → Gemini API 키
3. **Aside**: 앱을 켜고 CLI를 로그인합니다. `aside login --email <내 이메일>` 실행 후 Aside 설정 > Account > Devices에서 승인합니다.
   특정 프로필을 쓰려면 `aside host profiles`로 ID를 확인해 `ASIDE_PROFILE`에 넣습니다.
4. **Vercel**: 프로젝트 `bplepay-map`(https://bplepay-map.vercel.app)이 GitHub 저장소와 연결돼 있습니다. Root Directory는 `web`이고, `main`에 푸시하면 자동으로 배포됩니다. 환경변수 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`은 Vercel에 등록돼 있습니다.

## 실행

```bash
npm install
npm run worker   # Mac 수집 워커 (켜 두기)
npm run dev      # 로컬에서 웹 확인 http://localhost:3000
```

구획 판별만 키 없이 시험하려면:

```bash
npx tsx worker/scripts/try-area.ts 역삼동 을지로 강남역
```

## 알아둘 점

- 네이버 검색 API는 캡차 토큰을 요구해 직접 부르지 않습니다. Aside 브라우저로 검색 화면을 열고, 지도가 스스로 받아온 경계 데이터만 다시 읽습니다.
- 같은 이름의 도로가 여러 도시에 있으면 가장 길게 이어진 쪽을 고릅니다.
- 오픈스트리트맵 기본 타일 서버는 트래픽이 많으면 차단될 수 있습니다. 그때는 `src/components/MapView.tsx`의 `L.tileLayer` 주소를 다른 무료 타일(예: CARTO)로 바꿉니다.
- 업종 판정 기준(카페·주점 제외 등)은 `worker/filter.ts`의 프롬프트에서 고칩니다. 이미 판정된 업종은 `category_filter` 테이블에 캐시되므로, 기준을 바꾸면 그 테이블을 비웁니다.
