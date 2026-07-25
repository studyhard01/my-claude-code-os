// ============================================================================
// /api/companies/:id/research 라우트 테스트 (OS.md 12.11, M2b 조각 1)
// ----------------------------------------------------------------------------
// 계약 기준:
//  - GET aggregate: 회사 메타 + note(없으면 null) + researchStatus "PENDING",
//    없는 회사 404 COMPANY_NOT_FOUND (12.5).
//  - PUT note upsert(idempotent, 생성→수정 재조회 유지), 빈/공백 content = 삭제,
//    없는 회사 404 · 잘못된 body 400 INVALID_BODY.
//  - DELETE 멱등 204(노트 없어도 204, 회사 없으면 404).
// DB = prisma/test.db (setup/env-db.ts 가 import 전에 DATABASE_URL 교체).
// ============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/companies/[id]/research/route";
import { PUT, DELETE } from "@/app/api/companies/[id]/research/note/route";
import { prisma } from "@/lib/db";
import type {
  CompanyResearchResponse,
  ResearchNoteResponse,
} from "@/types/contract";

let seq = 0;

async function mkCompany(name: string, careersPageUrl: string | null = null) {
  seq += 1;
  const id = `resc${String(seq).padStart(3, "0")}`;
  return prisma.company.create({
    // normName 은 UNIQUE — 테스트 이름이 겹치지 않게 id 를 섞는다
    data: { id, name, normName: `${name.toLowerCase()}-${id}`, careersPageUrl },
  });
}

function getResearch(id: string) {
  const req = new NextRequest(`http://test.local/api/companies/${id}/research`);
  return GET(req, { params: Promise.resolve({ id }) });
}

function putNote(id: string, body: unknown) {
  const req = new NextRequest(
    `http://test.local/api/companies/${id}/research/note`,
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
  return PUT(req, { params: Promise.resolve({ id }) });
}

function deleteNote(id: string) {
  const req = new NextRequest(
    `http://test.local/api/companies/${id}/research/note`,
    { method: "DELETE" }
  );
  return DELETE(req, { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  seq = 0;
  await prisma.researchNote.deleteMany();
  await prisma.companySubscription.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.job.deleteMany();
  await prisma.company.deleteMany();
});

describe("GET /api/companies/:id/research — aggregate", () => {
  it("노트 없는 회사: 회사 메타 + note null + researchStatus PENDING", async () => {
    const company = await mkCompany("카카오", "https://kakao.com/careers");
    const res = await getResearch(company.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompanyResearchResponse;
    expect(body.company.id).toBe(company.id);
    expect(body.company.name).toBe("카카오");
    expect(body.company.careersPageUrl).toBe("https://kakao.com/careers");
    expect(body.note).toBeNull();
    expect(body.researchStatus).toBe("PENDING");
  });

  it("노트 있는 회사: note 필드에 내용이 실려 온다", async () => {
    const company = await mkCompany("네이버");
    await putNote(company.id, { content: "인재상 정리 필요" });
    const body = (await (
      await getResearch(company.id)
    ).json()) as CompanyResearchResponse;
    expect(body.note?.content).toBe("인재상 정리 필요");
    expect(body.note?.companyId).toBe(company.id);
    expect(typeof body.note?.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.note!.updatedAt))).toBe(false);
  });

  it("없는 회사 → 404 COMPANY_NOT_FOUND (12.5 ApiError)", async () => {
    const res = await getResearch("ghost");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("COMPANY_NOT_FOUND");
    expect(typeof body.error.message).toBe("string");
  });
});

describe("PUT /api/companies/:id/research/note — upsert", () => {
  it("생성 → 수정(2회) idempotent, 회사당 노트 1개 유지, 재조회 시 최신 내용", async () => {
    const company = await mkCompany("토스");

    const first = (await (
      await putNote(company.id, { content: "1차 메모" })
    ).json()) as ResearchNoteResponse;
    expect(first.note?.content).toBe("1차 메모");

    const second = (await (
      await putNote(company.id, { content: "2차 수정" })
    ).json()) as ResearchNoteResponse;
    expect(second.note?.content).toBe("2차 수정");
    // 회사당 1개 — 같은 노트를 갱신했다(id 동일)
    expect(second.note?.id).toBe(first.note?.id);
    expect(await prisma.researchNote.count()).toBe(1);

    // 재조회 유지
    const agg = (await (
      await getResearch(company.id)
    ).json()) as CompanyResearchResponse;
    expect(agg.note?.content).toBe("2차 수정");
  });

  it("빈/공백 content → 노트 삭제(200 note null, idempotent)", async () => {
    const company = await mkCompany("당근");
    await putNote(company.id, { content: "지울 메모" });
    expect(await prisma.researchNote.count()).toBe(1);

    const cleared = (await (
      await putNote(company.id, { content: "   " })
    ).json()) as ResearchNoteResponse;
    expect(cleared.note).toBeNull();
    expect(await prisma.researchNote.count()).toBe(0);

    // 노트 없는 상태에서 다시 빈 content 로 PUT 해도 무해(idempotent)
    const again = await putNote(company.id, { content: "" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as ResearchNoteResponse).note).toBeNull();
  });

  it("없는 회사 404, content 누락/타입 오류 400 INVALID_BODY", async () => {
    const ghost = await putNote("ghost", { content: "x" });
    expect(ghost.status).toBe(404);
    expect((await ghost.json()).error.code).toBe("COMPANY_NOT_FOUND");

    const company = await mkCompany("우아한형제들");
    const bad = await putNote(company.id, { content: 123 });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("INVALID_BODY");

    const noBody = await PUT(
      new NextRequest(
        `http://test.local/api/companies/${company.id}/research/note`,
        { method: "PUT" }
      ),
      { params: Promise.resolve({ id: company.id }) }
    );
    expect(noBody.status).toBe(400);
    expect((await noBody.json()).error.code).toBe("INVALID_BODY");
  });
});

describe("DELETE /api/companies/:id/research/note — 멱등 삭제", () => {
  it("노트 있으면 삭제 204, 없어도 204(idempotent), 회사 없으면 404", async () => {
    const company = await mkCompany("라인");
    await putNote(company.id, { content: "삭제 대상" });

    const del = await deleteNote(company.id);
    expect(del.status).toBe(204);
    expect(await prisma.researchNote.count()).toBe(0);

    // 이미 없어도 204
    const again = await deleteNote(company.id);
    expect(again.status).toBe(204);

    // 없는 회사는 404
    const ghost = await deleteNote("ghost");
    expect(ghost.status).toBe(404);
    expect((await ghost.json()).error.code).toBe("COMPANY_NOT_FOUND");
  });
});
