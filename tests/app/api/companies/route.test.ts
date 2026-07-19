// ============================================================================
// GET /api/companies 라우트 테스트 — 검색·목록 + isSubscribed (OS.md 12.9)
// ----------------------------------------------------------------------------
// 계약 기준: keyword 검색(원문 name + normName 동일성 키 양쪽), isSubscribed 는
// 구독 join 계산(isBookmarked 패턴), limit 기본/상한, 빈 결과는 에러 아님(items: []),
// 비정상 limit 은 조용히 무시(12.6 "미지의 필터값 무시"와 일관 — 500 금지).
// ============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/companies/route";
import { prisma } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/collect/normalizer";
import type { CompaniesListResponse } from "@/types/contract";

let seq = 0;

async function mkCompany(name: string) {
  seq += 1;
  const id = `cmpc${String(seq).padStart(3, "0")}`;
  return prisma.company.create({
    // normName = 실제 규칙(normalizeCompanyName)으로 계산 — 검색 매칭 검증의 전제
    data: { id, name, normName: normalizeCompanyName(name) },
  });
}

async function callCompanies(qs = ""): Promise<CompaniesListResponse> {
  const res = await GET(new NextRequest(`http://test.local/api/companies${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()) as CompaniesListResponse;
}

beforeEach(async () => {
  seq = 0;
  await prisma.companySubscription.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.job.deleteMany();
  await prisma.company.deleteMany();
});

describe("GET /api/companies — 검색·목록", () => {
  it("keyword 없으면 전체를 이름 오름차순으로, 없는 회사 검색은 빈 목록(에러 아님)", async () => {
    await mkCompany("네이버");
    await mkCompany("카카오");

    const all = await callCompanies();
    expect(all.items.map((c) => c.name)).toEqual(["네이버", "카카오"]);

    const none = await callCompanies("?keyword=존재하지않는회사");
    expect(none.items).toEqual([]);
  });

  it("keyword 는 name contains 매칭 + isSubscribed 를 구독 join 으로 계산한다", async () => {
    const kakao = await mkCompany("카카오");
    await mkCompany("카카오모빌리티");
    await mkCompany("네이버");
    await prisma.companySubscription.create({ data: { companyId: kakao.id } });

    const body = await callCompanies("?keyword=카카오");
    expect(body.items.map((c) => c.name)).toEqual(["카카오", "카카오모빌리티"]);
    // 구독 상태는 Company 컬럼이 아니라 join 계산 — 구독한 카카오만 true
    expect(body.items.map((c) => c.isSubscribed)).toEqual([true, false]);
    // wire 형태: createdAt 은 ISO 문자열(계약 날짜 규약)
    expect(typeof body.items[0].createdAt).toBe("string");
  });

  it("표기 차이는 normName(동일성 키)으로 흡수: 공백·(주) 가 섞여도 찾는다", async () => {
    await mkCompany("카카오모빌리티");
    await mkCompany("네이버");

    // "카카오 모빌리티"(공백) → norm "카카오모빌리티" 로 매칭
    const spaced = await callCompanies(
      `?keyword=${encodeURIComponent("카카오 모빌리티")}`
    );
    expect(spaced.items.map((c) => c.name)).toEqual(["카카오모빌리티"]);

    // "(주)네이버" → norm "네이버" 로 매칭 (name contains 로는 실패하는 케이스)
    const corp = await callCompanies(
      `?keyword=${encodeURIComponent("(주)네이버")}`
    );
    expect(corp.items.map((c) => c.name)).toEqual(["네이버"]);
  });

  it("limit 이 적용되고, 비정상 limit(음수·비숫자)은 조용히 기본값으로 (500 금지)", async () => {
    await mkCompany("A사");
    await mkCompany("B사");
    await mkCompany("C사");

    const limited = await callCompanies("?limit=2");
    expect(limited.items).toHaveLength(2);

    const bad = await callCompanies("?limit=-1"); // callCompanies 가 200 을 단언
    expect(bad.items).toHaveLength(3); // 기본값(20) 적용

    const notNum = await callCompanies("?limit=abc");
    expect(notNum.items).toHaveLength(3);
  });
});
