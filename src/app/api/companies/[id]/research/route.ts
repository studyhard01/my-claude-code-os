// ============================================================================
// GET /api/companies/:id/research — 회사 리서치 aggregate (OS.md 12.11, M2b 조각 1)
// ----------------------------------------------------------------------------
// 회사 메타 + 리서치 노트(없으면 null) + 외부 데이터 슬롯 상태.
//   없는 회사 → 404 COMPANY_NOT_FOUND (12.5 ApiError, subscriptions POST 패턴).
// 외부 데이터(공시·인재상)는 조각 2·3 에서 채운다 → 지금은 researchStatus="PENDING"
//   만 돌려주고, 프론트가 company.careersPageUrl/공고 원문 링크로 폴백한다(빈 화면 금지).
// 리서치 진입은 companyId 있는 공고·구독 회사에서만 오므로(12.11 진입 구조),
//   여기 id 는 Company.id 다.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type {
  ApiError,
  CompanyResearchResponse,
  ResearchNote,
} from "@/types/contract";

/** ResearchNote DB 행 → wire 형태(날짜 ISO 문자열 — 계약의 날짜 규약) */
function noteToWire(note: {
  id: string;
  companyId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}): ResearchNote {
  return {
    id: note.id,
    companyId: note.companyId,
    content: note.content,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const company = await prisma.company.findUnique({
    where: { id },
    include: { researchNote: true },
  });

  if (!company) {
    const err: ApiError = {
      error: {
        code: "COMPANY_NOT_FOUND",
        message: `회사를 찾을 수 없습니다: ${id}`,
      },
    };
    return NextResponse.json(err, { status: 404 });
  }

  const body: CompanyResearchResponse = {
    company: {
      id: company.id,
      name: company.name,
      normName: company.normName,
      careersPageUrl: company.careersPageUrl,
      createdAt: company.createdAt.toISOString(),
    },
    note: company.researchNote ? noteToWire(company.researchNote) : null,
    // 조각 1 에선 외부 데이터 미연동 → 항상 PENDING (조각 2·3 에서 READY 로 전환).
    researchStatus: "PENDING",
  };
  return NextResponse.json(body);
}
