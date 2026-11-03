// Aside 브라우저로 네이버지도를 열어 동 경계 폴리곤을 가져온다.
// 네이버 검색 API는 캡차 토큰을 요구하므로 직접 부르지 않는다. 검색 화면을 사람이 보듯 열고,
// 지도가 스스로 요청한 경계 데이터(/p/api/polygon)만 같은 주소로 다시 읽는다.
import { execFile } from "node:child_process";
import type { FeatureCollection } from "geojson";

const MARK = "@@RESULT ";

function runRepl(code: string): Promise<string> {
  const args = ["repl"];
  if (process.env.ASIDE_PROFILE) args.push("--profile", process.env.ASIDE_PROFILE);
  args.push(code);
  return new Promise((resolve, reject) => {
    execFile("aside", args, { timeout: 150_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      const line = stdout.split("\n").find((l) => l.startsWith(MARK));
      if (line) return resolve(line.slice(MARK.length));
      reject(new Error(`aside repl 실패: ${(err?.message ?? "")} ${stdout.slice(-500)} ${stderr.slice(-300)}`));
    });
  });
}

export async function naverDongPolygon(name: string): Promise<FeatureCollection | null> {
  const url = "https://map.naver.com/p/search/" + encodeURIComponent(name);
  const code = `await (async () => {
    const tab = await openTab(${JSON.stringify(url)});
    let polyUrl = null;
    for (let i = 0; i < 20 && !polyUrl; i++) {
      await sleep(500);
      polyUrl = await tab.evaluate(() => (performance.getEntriesByType("resource").map(e => e.name).find(n => n.includes("/p/api/polygon")) || null));
    }
    let body = null;
    if (polyUrl) body = await tab.evaluate(async (u) => (await fetch(u)).text(), polyUrl);
    const title = await tab.title();
    await closeTab(tab);
    console.log(${JSON.stringify(MARK)} + JSON.stringify({ title, body }));
  })();`;
  const { body } = JSON.parse(await runRepl(code)) as { title: string; body: string | null };
  if (!body) return null;
  const fc = JSON.parse(body) as FeatureCollection;
  return fc.features?.length ? fc : null;
}
