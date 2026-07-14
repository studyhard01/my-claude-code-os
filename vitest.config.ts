import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-db.ts"],
    setupFiles: ["tests/setup/env-db.ts"],
    // DB 테스트가 공유하는 test.db 의 경합 방지 — 파일 단위 직렬 실행
    // (전체 스위트가 밀리초 단위라 병렬화 이득이 없다)
    fileParallelism: false,
  },
});
