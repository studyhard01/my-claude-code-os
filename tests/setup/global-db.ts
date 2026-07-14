// vitest globalSetup — 테스트 전용 SQLite(prisma/test.db)에 스키마를 1회 반영.
// 실 dev.db 는 절대 건드리지 않는다. 환경변수가 .env 보다 우선하므로
// DATABASE_URL 만 갈아끼우면 같은 schema.prisma 를 그대로 쓴다.
// (--skip-generate: 클라이언트는 이미 생성돼 있고, 엔진 다운로드(사내망 TLS 함정)도 회피)
import { execSync } from "node:child_process";

export default function setup() {
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
  });
}
