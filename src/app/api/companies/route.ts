// ============================================================================
// GET /api/companies?keyword=&limit= — 회사 검색·목록 (OS.md 12.9, M2a 조각 ②)
// ----------------------------------------------------------------------------
// 용도: 온보딩 관심 회사 등록(조각 ③)·구독 관리 UI 의 회사 선택지.
// isSubscribed 는 Company 컬럼이 아니라 구독 join 으로 계산(isBookmarked 패턴 —
//   구독 상태의 진실 출처를 CompanySubscription 테이블 하나로 유지).
//
// [설계 결정]
//  - keyword 는 name(원문 표기) contains 에 더해 normName(동일성 키) contains 도 본다.
//    "카카오 모빌리티"(공백)·"(주)카카오" 같은 표기 차이를 normalizeCompanyName —
//    회사 동일성의 단일 출처(12.8(3)/12.9) — 로 흡수하기 위함. 정규화 결과가 빈
//    문자열이면 그 절은 뺀다(contains "" 가 전부 매칭되는 사고 방지).
//  - limit 기본 20·상한 100. 비정상 값(음수·비숫자)은 조용히 기본값 —
//    12.6 "미지의 필터값은 무시(500 금지)" 규약과 일관.
//  - 빈 결과는 에러 아님(items: []) — 12.5.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/collect/normalizer";
import type { CompaniesListResponse, CompanyListItem } from "@/types/contract";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const keyword = sp.get("keyword")?.trim() ?? "";
  const limitRaw = sp.get("limit");

  let limit = DEFAULT_LIMIT;
  if (limitRaw != null && limitRaw !== "") {
    const n = Number(limitRaw);
    if (Number.isInteger(n) && n > 0) limit = Math.min(n, MAX_LIMIT);
  }

  let where: Prisma.CompanyWhereInput = {};
  if (keyword) {
    const or: Prisma.CompanyWhereInput[] = [{ name: { contains: keyword } }];
    const normKeyword = normalizeCompanyName(keyword);
    if (normKeyword) or.push({ normName: { contains: normKeyword } });
    where = { OR: or };
  }

  const companies = await prisma.company.findMany({
    where,
    // 회사 선택지 목록 → 이름 오름차순(안정 tiebreak 로 id)
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit,
    include: { subscriptions: true },
  });

  const body: CompaniesListResponse = {
    items: companies.map(
      (c): CompanyListItem => ({
        id: c.id,
        name: c.name,
        normName: c.normName,
        careersPageUrl: c.careersPageUrl,
        createdAt: c.createdAt.toISOString(),
        // 단일 로컬 사용자 + companyId UNIQUE → 구독은 최대 1건
        isSubscribed: c.subscriptions.length > 0,
      })
    ),
  };
  return NextResponse.json(body);
}
