// ============================================================================
// /api/bookmarks 라우트 테스트 — GET·POST + PATCH·DELETE (OS.md 12.5) (ralph-test)
// ----------------------------------------------------------------------------
// 계약 기준: POST idempotent(공고당 1건, 기존 것 반환), 저장 목록은 마감 공고도
// 표시(includeExpired 무시), status 검증(400)·없는 리소스(404)의 ApiError 형태,
// DELETE 204 본문 없음. DB = prisma/test.db (setup 이 격리, 6바퀴 구축).
// ============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/bookmarks/route";
import { DELETE, PATCH } from "@/app/api/bookmarks/[id]/route";
import { prisma } from "@/lib/db";
import type { BookmarksListResponse, CreateBookmarkResponse } from "@/types/contract";

let seq = 0;

async function mkJob(overrides: Record<string, unknown> = {}) {
  seq += 1;
  const id = `bmj${String(seq).padStart(3, "0")}`;
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

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://test.local/api/bookmarks", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function patchReq(id: string, body: unknown) {
  const req = new NextRequest(`http://test.local/api/bookmarks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

function deleteReq(id: string) {
  const req = new NextRequest(`http://test.local/api/bookmarks/${id}`, { method: "DELETE" });
  return DELETE(req, { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  seq = 0;
  await prisma.bookmark.deleteMany();
  await prisma.job.deleteMany();
});

describe("POST /api/bookmarks — 생성 (idempotent)", () => {
  it("정상 생성: 201 + 기본 status PLANNED", async () => {
    const job = await mkJob();
    const res = await POST(postReq({ jobId: job.id }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateBookmarkResponse;
    expect(body.status).toBe("PLANNED");
    expect(body.bookmarkId).toBeTruthy();
  });

  it("같은 공고에 두 번 POST 해도 같은 북마크를 돌려준다 (공고당 1건)", async () => {
    const job = await mkJob();
    const first = (await (await POST(postReq({ jobId: job.id }))).json()) as CreateBookmarkResponse;
    const second = (await (await POST(postReq({ jobId: job.id }))).json()) as CreateBookmarkResponse;
    expect(second.bookmarkId).toBe(first.bookmarkId);
    expect(await prisma.bookmark.count()).toBe(1);
  });

  it("jobId 누락/본문 없음 → 400 INVALID_BODY, 없는 공고 → 404 JOB_NOT_FOUND", async () => {
    const noBody = await POST(new NextRequest("http://test.local/api/bookmarks", { method: "POST" }));
    expect(noBody.status).toBe(400);
    expect((await noBody.json()).error.code).toBe("INVALID_BODY");

    const ghost = await POST(postReq({ jobId: "ghost" }));
    expect(ghost.status).toBe(404);
    expect((await ghost.json()).error.code).toBe("JOB_NOT_FOUND");
  });
});

describe("GET /api/bookmarks — 저장 목록", () => {
  it("최신 저장순으로, 마감 지난 공고도 표시한다 (12.6 includeExpired 무시)", async () => {
    const expired = await mkJob({ deadline: new Date("2020-01-01T00:00:00Z") });
    const alive = await mkJob();
    await prisma.bookmark.create({
      data: { jobId: expired.id, createdAt: new Date("2026-07-01T00:00:00Z") },
    });
    await prisma.bookmark.create({
      data: { jobId: alive.id, createdAt: new Date("2026-07-02T00:00:00Z") },
    });

    const res = await GET(new NextRequest("http://test.local/api/bookmarks"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as BookmarksListResponse;
    expect(body.items.map((j) => j.id)).toEqual([alive.id, expired.id]); // 최신 저장이 앞
    expect(body.items[0].bookmark?.status).toBe("PLANNED"); // JobDTO 에 bookmark join
  });

  it("status 필터가 적용되고, 미지의 status 는 400", async () => {
    const a = await mkJob();
    const b = await mkJob();
    await prisma.bookmark.create({ data: { jobId: a.id, status: "APPLIED" } });
    await prisma.bookmark.create({ data: { jobId: b.id, status: "PLANNED" } });

    const filtered = await GET(new NextRequest("http://test.local/api/bookmarks?status=APPLIED"));
    const body = (await filtered.json()) as BookmarksListResponse;
    expect(body.items.map((j) => j.id)).toEqual([a.id]);

    const bad = await GET(new NextRequest("http://test.local/api/bookmarks?status=WISHLIST"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("INVALID_STATUS");
  });
});

describe("PATCH·DELETE /api/bookmarks/:id", () => {
  it("PATCH: 상태 변경 200, 허용 밖 status 400, 없는 id 404", async () => {
    const job = await mkJob();
    const bm = await prisma.bookmark.create({ data: { jobId: job.id } });

    const ok = await patchReq(bm.id, { status: "APPLIED" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("APPLIED");

    const bad = await patchReq(bm.id, { status: "WISHLIST" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("INVALID_STATUS");

    const ghost = await patchReq("ghost", { status: "APPLIED" });
    expect(ghost.status).toBe(404);
    expect((await ghost.json()).error.code).toBe("BOOKMARK_NOT_FOUND");
  });

  it("DELETE: 204 본문 없음 + 실제 삭제, 없는 id 404", async () => {
    const job = await mkJob();
    const bm = await prisma.bookmark.create({ data: { jobId: job.id } });

    const ok = await deleteReq(bm.id);
    expect(ok.status).toBe(204);
    expect(await prisma.bookmark.count()).toBe(0);

    const ghost = await deleteReq(bm.id); // 이미 지워짐
    expect(ghost.status).toBe(404);
    expect((await ghost.json()).error.code).toBe("BOOKMARK_NOT_FOUND");
  });
});
