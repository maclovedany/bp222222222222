// Gemini REST 호출. 웹 서버(자연어 검색)와 Mac 워커(업종 필터)가 함께 쓴다.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

export async function geminiJson<T>(prompt: string): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  // 모델이 코드 블록으로 감싸 보내는 경우도 받아준다.
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

export type ParsedQuery = { area: string; category: string | null };

export async function parseNaturalQuery(q: string): Promise<ParsedQuery> {
  const out = await geminiJson<ParsedQuery>(
    `사용자가 한국 식당 지도에서 검색한 문장을 구획과 음식 종류로 나눠라.
- area: 동 이름(예: 역삼동), 도로명(예: 을지로), 지명(예: 강남역) 중 하나. 문장에 나온 표기 그대로, 공백 없이.
- category: 음식 종류 한 단어(예: 한식, 중식, 일식, 양식, 분식, 치킨, 고기, 국밥). 없으면 null.
JSON 한 개만 출력: {"area": string, "category": string|null}

문장: ${JSON.stringify(q)}`,
  );
  if (!out?.area) throw new Error("검색어에서 구획 이름을 찾지 못했습니다");
  return { area: out.area.replace(/\s+/g, ""), category: out.category || null };
}
