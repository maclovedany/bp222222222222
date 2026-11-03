import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 폴더의 다른 lockfile을 프로젝트 루트로 오인하지 않게 한다.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
