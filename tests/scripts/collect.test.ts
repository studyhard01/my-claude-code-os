// ============================================================================
// scripts/collect.ts 테스트 — 수집 진입점을 자식 프로세스로 실제 실행 (ralph-test)
// ----------------------------------------------------------------------------
// collect.ts 는 import 즉시 main() 이 도는 스크립트라 함수 단위로 못 잡는다.
// 대신 실제 실행 경로(어댑터→Normalizer→upsert) 전체를 tsx 자식 프로세스로 태우고,
// DATABASE_URL 만 test.db 로 넘겨 실 dev.db 를 격리한다(6바퀴 인프라).
// 계약 기준(12.8 (4)): (source,sourceJobId) upsert 로 재실행 시 신규 0(idempotent),
// 키 없는 실 소스는 조용한 폴백 없이 즉시 실패, 알 수 없는 소스도 실패.
// ============================================================================

import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

/** collect.ts 를 자식 프로세스로 실행. 성공 시 stdout, 실패 시 throw(캐치해서 검사) */
function runCollect(env: Record<string, string>): string {
  return execSync("npx tsx scripts/collect.ts", {
    env: { ...process.env, DATABASE_URL: "file:./test.db", ...env },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCollectExpectFail(env: Record<string, string>): { status: number; stderr: string } {
  try {
    runCollect(env);
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? -1, stderr: String(err.stderr ?? "") };
  }
  throw new Error("실패해야 하는 실행이 성공했다");
}

beforeEach(async () => {
  await prisma.bookmark.deleteMany();
  await prisma.job.deleteMany();
});

describe("collect — fixture 경로 end-to-end + idempotent (12.8)", () => {
  it("saramin-fixture: 1회차는 신규 적재, 2회차 재실행은 신규 0 (upsert 키)", { timeout: 90_000 }, async () => {
    const first = runCollect({ COLLECT_SOURCE: "saramin-fixture" });
    const afterFirst = await prisma.job.count({ where: { source: "saramin" } });
    expect(afterFirst).toBeGreaterThan(0);
    expect(first).toMatch(new RegExp(`신규 ${afterFirst} / 갱신 0`));

    const second = runCollect({ COLLECT_SOURCE: "saramin-fixture" });
    expect(second).toMatch(new RegExp(`신규 0 / 갱신 ${afterFirst}`));
    expect(await prisma.job.count({ where: { source: "saramin" } })).toBe(afterFirst); // 중복 생성 없음
  });

  it("alio-fixture: 잡알리오 경로도 적재되고 본문(description)이 채워진다", { timeout: 60_000 }, async () => {
    runCollect({ COLLECT_SOURCE: "alio-fixture" });
    const rows = await prisma.job.findMany({ where: { source: "alio" } });
    expect(rows.length).toBeGreaterThan(0);
    // 잡알리오의 가치 = 본문 결합(사람인 약점 보완, STATUS/12.8(5))
    expect(rows.some((r) => r.description && r.description.length > 0)).toBe(true);
  });
});

describe("collect — 조용한 폴백 금지 (12.8)", () => {
  it("COLLECT_SOURCE=saramin 인데 키가 없으면 mock 으로 넘어가지 않고 즉시 실패", { timeout: 60_000 }, async () => {
    const { status, stderr } = runCollectExpectFail({
      COLLECT_SOURCE: "saramin",
      SARAMIN_ACCESS_KEY: "",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("SARAMIN_ACCESS_KEY");
    expect(await prisma.job.count()).toBe(0); // 아무것도 적재되지 않음
  });

  it("알 수 없는 COLLECT_SOURCE 는 즉시 실패한다", { timeout: 60_000 }, () => {
    const { status, stderr } = runCollectExpectFail({ COLLECT_SOURCE: "wanted" });
    expect(status).not.toBe(0);
    expect(stderr).toContain("알 수 없는 COLLECT_SOURCE");
  });
});
