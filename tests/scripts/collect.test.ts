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

/**
 * collect.ts 를 자식 프로세스로 실행. 성공 시 stdout, 실패 시 throw(캐치해서 검사).
 * COLLECT_NOW 를 fixture 채집 시점(2026-07-14)으로 고정한다 — 만료 스킵(M2 위생)이
 * 실제 달력 기준으로 돌면 fixture 마감일(7~9월)이 지나는 순간 테스트가 저절로
 * 깨진다(평가 게이트 C3 사고와 같은 유형). 스킵 동작 자체는 COLLECT_NOW 를
 * 덮어쓰는 전용 테스트에서 검증한다.
 */
function runCollect(env: Record<string, string>): string {
  return execSync("npx tsx scripts/collect.ts", {
    env: {
      ...process.env,
      DATABASE_URL: "file:./test.db",
      COLLECT_NOW: "2026-07-14T00:00:00Z",
      ...env,
    },
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
  await prisma.company.deleteMany(); // FK 참조하는 job 을 먼저 지운 뒤
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

  it("kakao-fixture: 1회차 적재 후 재실행하면 신규 0 (idempotent, 12.8(4))", { timeout: 90_000 }, async () => {
    const first = runCollect({ COLLECT_SOURCE: "kakao-fixture" });
    const afterFirst = await prisma.job.count({ where: { source: "kakao" } });
    expect(afterFirst).toBe(8); // fixture 9건 - realId 없는 1건
    expect(first).toMatch(new RegExp(`신규 ${afterFirst} / 갱신 0`));

    const second = runCollect({ COLLECT_SOURCE: "kakao-fixture" });
    expect(second).toMatch(new RegExp(`신규 0 / 갱신 ${afterFirst}`));
    expect(await prisma.job.count({ where: { source: "kakao" } })).toBe(afterFirst);
  });

  it("만료 스킵(M2 위생): 마감 지난 공고는 적재하지 않고 스킵 수를 보고한다", { timeout: 60_000 }, async () => {
    // alio fixture 6건 = 마감일 5건(2026-07-25 ~ 09-01) + 상시(빈 값) 1건.
    // 기준 시각을 전부 지난 뒤(2026-12-01)로 주입 → 5건 스킵, 상시 1건만 적재.
    const out = runCollect({ COLLECT_SOURCE: "alio-fixture", COLLECT_NOW: "2026-12-01T00:00:00Z" });
    expect(out).toMatch(/만료 스킵 5/);
    const rows = await prisma.job.findMany({ where: { source: "alio" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].deadline).toBeNull(); // 상시채용은 만료가 아니다
  });

  it("만료 스킵: 잘못된 COLLECT_NOW 는 조용히 넘어가지 않고 즉시 실패한다", { timeout: 60_000 }, async () => {
    const { status, stderr } = runCollectExpectFail({
      COLLECT_SOURCE: "alio-fixture",
      COLLECT_NOW: "언제든지",
    });
    expect(status).not.toBe(0);
    expect(stderr).toContain("COLLECT_NOW");
    expect(await prisma.job.count()).toBe(0);
  });

  it("kakao-fixture: 카카오의 가치 = 직무가 붙은 공고 + 본문 (잡알리오 공백 보완)", { timeout: 60_000 }, async () => {
    runCollect({ COLLECT_SOURCE: "kakao-fixture" });
    const rows = await prisma.job.findMany({ where: { source: "kakao" } });

    // 이 어댑터를 넣은 이유(STATUS): 조건 필터가 걸 대상 = jobRole 이 붙은 공고
    expect(rows.filter((r) => r.jobRole !== null).length).toBeGreaterThanOrEqual(5);
    expect(rows.some((r) => r.description && r.description.length > 0)).toBe(true);
    // url 은 전 건 공고 상세로 조립된다(12.8(6)) — PARTIAL 이어도 원문 확인 경로가 있다
    expect(rows.every((r) => r.url.startsWith("https://careers.kakao.com/jobs/"))).toBe(true);
    // [실측] 카카오 테크 공고는 상시채용 → deadline 전건 null
    expect(rows.every((r) => r.deadline === null)).toBe(true);
  });
});

describe("collect — 회사-공고 연결 (12.9 조각 ①)", () => {
  it("수집 시 companyId 가 채워지고, 재실행해도 Company 중복 생성 0", { timeout: 90_000 }, async () => {
    runCollect({ COLLECT_SOURCE: "kakao-fixture" });
    const jobs = await prisma.job.findMany({ where: { source: "kakao" } });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.companyId !== null)).toBe(true); // 카카오 fixture 는 회사명 전건 존재

    // Company 행 수 = distinct 회사 수 (normName UNIQUE)
    const companies = await prisma.company.count();
    const distinctNames = new Set(jobs.map((j) => j.companyName)).size;
    expect(companies).toBe(distinctNames);

    runCollect({ COLLECT_SOURCE: "kakao-fixture" }); // 재수집
    expect(await prisma.company.count()).toBe(companies); // 중복 생성 0
  });

  it('placeholder "(회사 미확인)" 공고는 연결하지 않는다 (companyId null 유지)', { timeout: 60_000 }, async () => {
    runCollect({ COLLECT_SOURCE: "saramin-fixture" }); // 회사명 누락 1건 포함 fixture
    const placeholder = await prisma.job.findMany({ where: { companyName: "(회사 미확인)" } });
    expect(placeholder.length).toBeGreaterThan(0);
    expect(placeholder.every((j) => j.companyId === null)).toBe(true);
    // 가짜 회사 엔티티가 생기지 않았다
    expect(await prisma.company.count({ where: { name: "(회사 미확인)" } })).toBe(0);
  });

  it("backfill: 기존 행(companyId null)을 같은 규칙으로 연결, idempotent", { timeout: 90_000 }, async () => {
    // 조각 ① 이전에 적재된 행을 흉내 낸다 — companyId 없이 직접 insert
    const base = {
      url: "https://example.com/job",
      title: "백엔드 개발자",
      experienceLevel: "ANY",
      dataQuality: "PARTIAL",
      dedupKey: "테스트|backend|",
    };
    await prisma.job.create({
      data: { ...base, source: "test", sourceJobId: "b1", companyName: "(주)백필테스트" },
    });
    await prisma.job.create({
      data: { ...base, source: "test", sourceJobId: "b2", companyName: "주식회사 백필테스트" }, // 같은 회사(정규화 동일)
    });
    await prisma.job.create({
      data: { ...base, source: "test", sourceJobId: "b3", companyName: "(회사 미확인)" },
    });

    const run = () =>
      execSync("npx tsx scripts/backfill-companies.ts", {
        env: { ...process.env, DATABASE_URL: "file:./test.db" },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });

    const first = run();
    expect(first).toMatch(/연결 2건/); // placeholder 제외
    expect(first).toMatch(/신규 회사 1곳/); // 정규화 동일 → 회사 1곳으로 수렴

    const linked = await prisma.job.findMany({ where: { source: "test" }, orderBy: { sourceJobId: "asc" } });
    expect(linked[0].companyId).not.toBeNull();
    expect(linked[0].companyId).toBe(linked[1].companyId); // 같은 회사로 연결
    expect(linked[2].companyId).toBeNull(); // placeholder 는 그대로

    const second = run(); // 재실행 무해
    expect(second).toMatch(/연결 0건/);
    expect(second).toMatch(/신규 회사 0곳/);
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

  it("알 수 없는 COLLECT_SOURCE 는 즉시 실패하고, 쓸 수 있는 소스를 알려준다", { timeout: 60_000 }, () => {
    const { status, stderr } = runCollectExpectFail({ COLLECT_SOURCE: "wanted" });
    expect(status).not.toBe(0);
    expect(stderr).toContain("알 수 없는 COLLECT_SOURCE");
    // 소스를 추가하면 안내 문구도 함께 갱신되어야 한다(스위치와 문구의 드리프트 방지)
    expect(stderr).toContain("kakao-fixture");
    expect(stderr).toContain("kakao");
  });
});
