// ============================================================================
// /api/subscriptions 라우트 테스트 — GET·POST + DELETE (OS.md 12.9, M2a 조각 ②)
// ----------------------------------------------------------------------------
// 계약 기준: POST idempotent(회사당 1건, 기존 것 반환 — Bookmark POST 패턴),
// 잘못된 body 400 · 없는 회사 404 · 없는 구독 DELETE 404 의 ApiError 형태(12.5),
// DELETE 204 본문 없음, 빈 목록은 에러 아님(items: []).
// DB = prisma/test.db (setup/env-db.ts 가 import 전에 DATABASE_URL 교체).
// ============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/subscriptions/route";
import { DELETE } from "@/app/api/subscriptions/[id]/route";
import { prisma } from "@/lib/db";
import type {
  CreateSubscriptionResponse,
  SubscriptionsListResponse,
} from "@/types/contract";

let seq = 0;

async function mkCompany(name: string) {
  seq += 1;
  const id = `subc${String(seq).padStart(3, "0")}`;
  return prisma.company.create({
    // normName 은 UNIQUE — 테스트 이름이 겹치지 않게 id 를 섞는다
    data: { id, name, normName: `${name.toLowerCase()}-${id}` },
  });
}

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://test.local/api/subscriptions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function deleteReq(id: string) {
  const req = new NextRequest(`http://test.local/api/subscriptions/${id}`, {
    method: "DELETE",
  });
  return DELETE(req, { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  seq = 0;
  await prisma.companySubscription.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.job.deleteMany();
  await prisma.company.deleteMany();
});

describe("POST /api/subscriptions — 생성 (idempotent)", () => {
  it("정상 생성: 201 + CompanySubscription wire 형태(createdAt ISO 문자열)", async () => {
    const company = await mkCompany("카카오");
    const res = await POST(postReq({ companyId: company.id }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateSubscriptionResponse;
    expect(body.companyId).toBe(company.id);
    expect(body.id).toBeTruthy();
    expect(typeof body.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
  });

  it("같은 회사에 두 번 POST 해도 구독은 1개, 같은 id 를 돌려준다 (회사당 1건)", async () => {
    const company = await mkCompany("카카오");
    const first = (await (
      await POST(postReq({ companyId: company.id }))
    ).json()) as CreateSubscriptionResponse;
    const second = (await (
      await POST(postReq({ companyId: company.id }))
    ).json()) as CreateSubscriptionResponse;
    expect(second.id).toBe(first.id);
    expect(await prisma.companySubscription.count()).toBe(1);
  });

  it("companyId 누락/본문 없음 → 400 INVALID_BODY, 없는 회사 → 404 COMPANY_NOT_FOUND", async () => {
    const noBody = await POST(
      new NextRequest("http://test.local/api/subscriptions", { method: "POST" })
    );
    expect(noBody.status).toBe(400);
    expect((await noBody.json()).error.code).toBe("INVALID_BODY");

    const ghost = await POST(postReq({ companyId: "ghost" }));
    expect(ghost.status).toBe(404);
    expect((await ghost.json()).error.code).toBe("COMPANY_NOT_FOUND");
  });
});

describe("GET·DELETE /api/subscriptions — 목록·해제 왕복", () => {
  it("생성 → 목록에 보임 → DELETE 204 → 목록 비움(빈 결과는 에러 아님)", async () => {
    const company = await mkCompany("네이버");
    const created = (await (
      await POST(postReq({ companyId: company.id }))
    ).json()) as CreateSubscriptionResponse;

    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as SubscriptionsListResponse;
    expect(list.items.map((s) => s.id)).toEqual([created.id]);
    expect(list.items[0].companyId).toBe(company.id);

    const del = await deleteReq(created.id);
    expect(del.status).toBe(204);
    expect(await prisma.companySubscription.count()).toBe(0);

    const afterRes = await GET();
    expect(afterRes.status).toBe(200); // 빈 목록도 정상 응답(12.5)
    const after = (await afterRes.json()) as SubscriptionsListResponse;
    expect(after.items).toEqual([]);
  });

  it("목록은 최신 구독순(createdAt 내림차순)", async () => {
    const a = await mkCompany("A사");
    const b = await mkCompany("B사");
    await prisma.companySubscription.create({
      data: { companyId: a.id, createdAt: new Date("2026-07-01T00:00:00Z") },
    });
    await prisma.companySubscription.create({
      data: { companyId: b.id, createdAt: new Date("2026-07-02T00:00:00Z") },
    });

    const list = (await (await GET()).json()) as SubscriptionsListResponse;
    expect(list.items.map((s) => s.companyId)).toEqual([b.id, a.id]);
  });

  it("DELETE: 없는 id → 404 SUBSCRIPTION_NOT_FOUND (12.5 ApiError 형태)", async () => {
    const ghost = await deleteReq("ghost");
    expect(ghost.status).toBe(404);
    const body = await ghost.json();
    expect(body.error.code).toBe("SUBSCRIPTION_NOT_FOUND");
    expect(typeof body.error.message).toBe("string");
  });
});
