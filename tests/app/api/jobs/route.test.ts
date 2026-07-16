// ============================================================================
// GET /api/jobs 라우트 테스트 — 테스트 전용 SQLite (OS.md 12.5/12.6) (ralph-test)
// ----------------------------------------------------------------------------
// 계약 기준: 만료 기본 제외(상시 null 은 만료 아님), deadline 정렬(null 맨 뒤),
// recent 정렬(postedAt 내림차순·null 맨 뒤), role 다중값 OR,
// PARTIAL 보호 집계(totalCount = kept + partialHidden), 미지의 필터값 무시(500 금지).
// DB = prisma/test.db (setup/env-db.ts 가 import 전에 DATABASE_URL 교체).
// 만료 판정이 실제 시간을 쓰므로 날짜는 먼 과거(2020)/미래(2030)로 고정해 흔들림 제거.
// ============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/jobs/route";
import { prisma } from "@/lib/db";
import type { JobsListResponse } from "@/types/contract";

let seq = 0;

/** 최소 필수 필드만 채운 Job 생성 (id 는 삽입 순서 고정 — 정렬 tiebreak 예측용) */
async function mkJob(overrides: Record<string, unknown> = {}) {
  seq += 1;
  const id = `t${String(seq).padStart(3, "0")}`;
  return prisma.job.create({
    data: {
      id,
      source: "test",
      sourceJobId: id,
      url: `https://example.com/${id}`,
      title: `공고 ${id}`,
      companyName: "테스트회사",
      jobRole: "backend",
      location: "서울",
      experienceLevel: "NEW",
      deadline: new Date("2030-01-15T00:00:00Z"),
      postedAt: new Date("2026-01-01T00:00:00Z"),
      dataQuality: "FULL",
      dedupKey: `테스트회사|backend|서울-${id}`,
      ...overrides,
    },
  });
}

async function callJobs(qs = ""): Promise<JobsListResponse> {
  const res = await GET(new NextRequest(`http://test.local/api/jobs${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()) as JobsListResponse;
}

beforeEach(async () => {
  seq = 0;
  await prisma.bookmark.deleteMany();
  await prisma.job.deleteMany();
});

describe("GET /api/jobs — 만료·정렬 (12.6)", () => {
  it("만료 공고는 기본 제외, 상시(deadline=null)는 포함되고 항상 맨 뒤", async () => {
    await mkJob({ deadline: new Date("2020-01-01T00:00:00Z") }); // 만료
    await mkJob({ deadline: new Date("2030-03-01T00:00:00Z") }); // 여유
    await mkJob({ deadline: null }); // 상시
    await mkJob({ deadline: new Date("2030-01-05T00:00:00Z") }); // 임박

    const body = await callJobs();
    expect(body.items.map((j) => j.id)).toEqual(["t004", "t002", "t003"]); // 임박→여유→상시
    expect(body.totalCount).toBe(3);
  });

  it("includeExpired=true 면 만료도 포함된다", async () => {
    await mkJob({ deadline: new Date("2020-01-01T00:00:00Z") });
    await mkJob({ deadline: new Date("2030-01-01T00:00:00Z") });

    const body = await callJobs("?includeExpired=true");
    expect(body.totalCount).toBe(2);
  });

  it("sort=recent 는 postedAt 내림차순, null 은 맨 뒤", async () => {
    await mkJob({ postedAt: new Date("2026-01-01T00:00:00Z") });
    await mkJob({ postedAt: new Date("2026-03-01T00:00:00Z") });
    await mkJob({ postedAt: null });

    const body = await callJobs("?sort=recent");
    expect(body.items.map((j) => j.id)).toEqual(["t002", "t001", "t003"]);
  });
});

describe("GET /api/jobs — 필터와 PARTIAL 보호 집계 (12.6)", () => {
  it("role 다중값(OR) 매칭 + PARTIAL(jobRole null)은 숨기되 totalCount 에 합산", async () => {
    await mkJob({ jobRole: "backend" });
    await mkJob({ jobRole: "frontend" });
    await mkJob({ jobRole: "data" }); // 필터 탈락(FULL) — 집계 미포함
    await mkJob({ jobRole: null, dataQuality: "PARTIAL" }); // 숨김 — 집계 포함

    const body = await callJobs("?role=backend,frontend");
    expect(body.items.map((j) => j.id)).toEqual(["t001", "t002"]);
    expect(body.partialHiddenCount).toBe(1);
    expect(body.totalCount).toBe(3); // kept 2 + hidden 1 (FULL 탈락은 미포함)
  });

  it("미지의 필터값은 조용히 무시 — 전부 미지여도 200 + 빈 목록 (500 금지)", async () => {
    await mkJob();
    const body = await callJobs("?role=ninja&location=화성");
    expect(body.items).toEqual([]);
    expect(body.totalCount).toBe(0);
  });

  it("keyword 는 제목·회사명을 함께 검색한다", async () => {
    await mkJob({ title: "결제 백엔드", companyName: "A" });
    await mkJob({ title: "무관", companyName: "결제나라" });
    await mkJob({ title: "무관", companyName: "B" });

    const body = await callJobs("?keyword=결제");
    expect(body.items.map((j) => j.id)).toEqual(["t001", "t002"]);
  });

  it("experience 다중값은 DB WHERE(in)로 걸러진다", async () => {
    await mkJob({ experienceLevel: "NEW" });
    await mkJob({ experienceLevel: "EXPERIENCED" });
    await mkJob({ experienceLevel: "ANY" });

    const body = await callJobs("?experience=NEW,ANY");
    expect(body.items.map((j) => j.id)).toEqual(["t001", "t003"]);
  });
});

describe("GET /api/jobs — role 예약 토큰 unassigned (12.6)", () => {
  it("role=unassigned 단독 → jobRole=null 전부(품질 무관), partialHiddenCount=0", async () => {
    await mkJob({ jobRole: "backend" }); // t001 — 유직무 → 제외
    await mkJob({ jobRole: null, dataQuality: "PARTIAL" }); // t002 — 매칭
    await mkJob({ jobRole: null, dataQuality: "FULL" }); // t003 — 매칭(품질 무관)

    const body = await callJobs("?role=unassigned");
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.map((j) => j.id)).toEqual(["t002", "t003"]);
    expect(body.items.every((j) => j.jobRole === null)).toBe(true);
    expect(body.totalCount).toBe(2);
    // 단독 + 다른 필터 없음 → null 은 "가려진" 게 아니라 요청된 매칭이므로 0 (12.6)
    expect(body.partialHiddenCount).toBe(0);
  });

  it("role=backend,unassigned → backend 이거나 미분류(OR), backend 단독 이상 totalCount", async () => {
    await mkJob({ jobRole: "backend" }); // t001 — 매칭
    await mkJob({ jobRole: "frontend" }); // t002 — 제외
    await mkJob({ jobRole: null, dataQuality: "PARTIAL" }); // t003 — unassigned 로 매칭

    const backendOnly = await callJobs("?role=backend");
    const combined = await callJobs("?role=backend,unassigned");

    expect(backendOnly.items.map((j) => j.id)).toEqual(["t001"]);
    expect(backendOnly.partialHiddenCount).toBe(1); // t003 은 기존 규칙대로 숨김 카운트

    expect(combined.items.map((j) => j.id)).toEqual(["t001", "t003"]);
    expect(combined.partialHiddenCount).toBe(0); // t003 이 매칭으로 승격 → 숨김 아님
    expect(combined.totalCount).toBeGreaterThanOrEqual(backendOnly.totalCount);
    expect(combined.items.length).toBeGreaterThan(backendOnly.items.length);
  });

  it("location null 유직무 공고는 unassigned 결과에 섞이지 않는다(대상은 오직 jobRole=null)", async () => {
    await mkJob({ jobRole: null }); // t001 — 매칭
    await mkJob({ jobRole: "frontend", location: null, dataQuality: "PARTIAL" }); // t002 — 다른 사유 PARTIAL, 비포함

    const body = await callJobs("?role=unassigned");
    expect(body.items.map((j) => j.id)).toEqual(["t001"]);
    expect(body.totalCount).toBe(1);
    expect(body.partialHiddenCount).toBe(0); // location 필터 비활성 → 그 차원 숨김 카운트 없음
  });

  it("미지값은 여전히 조용히 무시 — role=zzz 는 빈 목록, role=zzz,unassigned 는 null 버킷만", async () => {
    await mkJob({ jobRole: "backend" }); // t001
    await mkJob({ jobRole: null, dataQuality: "PARTIAL" }); // t002

    const unknownOnly = await callJobs("?role=zzz"); // callJobs 가 200 을 단언(500 금지)
    expect(unknownOnly.items).toEqual([]);
    expect(unknownOnly.partialHiddenCount).toBe(1); // t002 는 기존 PARTIAL 보호 규칙대로

    const mixed = await callJobs("?role=zzz,unassigned");
    expect(mixed.items.map((j) => j.id)).toEqual(["t002"]); // zzz 만 조용히 무시
    expect(mixed.totalCount).toBe(1);
  });

  it("role=unassigned + location 필터: location=null PARTIAL 은 location 차원으로 가려져 카운트된다", async () => {
    await mkJob({ jobRole: null, location: "서울", dataQuality: "PARTIAL" }); // t001 — 매칭
    await mkJob({ jobRole: null, location: null, dataQuality: "PARTIAL" }); // t002 — location 차원 숨김

    const body = await callJobs("?role=unassigned&location=서울");
    expect(body.items.map((j) => j.id)).toEqual(["t001"]);
    expect(body.partialHiddenCount).toBe(1); // 활성 필터(location) 차원의 null 로 가려진 수만 (12.6)
    expect(body.totalCount).toBe(2); // kept 1 + hidden 1
  });
});

describe("GET /api/jobs — 커서 페이지네이션", () => {
  it("PAGE_SIZE(20) 초과분은 nextCursor 로 잇는다", async () => {
    for (let i = 0; i < 22; i++) {
      await mkJob({ deadline: new Date(`2030-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`) });
    }

    const first = await callJobs();
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBe(first.items[19].id);
    expect(first.totalCount).toBe(22);

    const second = await callJobs(`?cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0].id).toBe("t021");
  });
});
