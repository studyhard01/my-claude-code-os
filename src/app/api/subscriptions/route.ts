// ============================================================================
// GET /api/subscriptions  — 구독 목록 (OS.md 12.9, M2a 조각 ②)
// POST /api/subscriptions — 구독 생성 (idempotent — Bookmark POST 패턴)
// ----------------------------------------------------------------------------
// 단일 로컬 사용자. 회사당 구독 1건(@@unique([companyId])).
// GET 목록은 프론트가 카드/상세의 구독 상태를 companyId 로 매칭하는 근거이자,
//   M3 회사 채용 페이지(ATS) 수집 대상 목록(9장)이다.
// POST: { companyId } → 201 + CompanySubscription. 이미 구독 중이면 기존 것 반환.
//   없는 회사 → 404 COMPANY_NOT_FOUND (Bookmark 의 JOB_NOT_FOUND 패턴).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type {
  ApiError,
  CompanySubscription,
  CreateSubscriptionResponse,
  SubscriptionsListResponse,
  SubscriptionWithCompany,
} from "@/types/contract";

/** DB 행 → wire 형태(createdAt ISO 문자열 — 계약의 날짜 규약) */
function toWire(sub: {
  id: string;
  companyId: string;
  createdAt: Date;
}): CompanySubscription {
  return {
    id: sub.id,
    companyId: sub.companyId,
    createdAt: sub.createdAt.toISOString(),
  };
}

export async function GET() {
  const subs = await prisma.companySubscription.findMany({
    // 최신 구독순(북마크 목록과 동일 감각). 동시각 대비 id tiebreak 로 순서 안정화.
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    // 12.11: 회사 메타 join — 구독 목록이 리서치 진입 구조이므로 이름·링크를 1왕복으로.
    include: { company: true },
  });
  const items: SubscriptionWithCompany[] = subs.map((sub) => ({
    ...toWire(sub),
    company: {
      id: sub.company.id,
      name: sub.company.name,
      normName: sub.company.normName,
      careersPageUrl: sub.company.careersPageUrl,
    },
  }));
  const body: SubscriptionsListResponse = { items };
  return NextResponse.json(body);
}

export async function POST(req: NextRequest) {
  let companyId: unknown;
  try {
    ({ companyId } = (await req.json()) as { companyId?: unknown });
  } catch {
    companyId = undefined;
  }

  if (typeof companyId !== "string" || !companyId) {
    const err: ApiError = {
      error: { code: "INVALID_BODY", message: "companyId 가 필요합니다." },
    };
    return NextResponse.json(err, { status: 400 });
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    const err: ApiError = {
      error: {
        code: "COMPANY_NOT_FOUND",
        message: `회사를 찾을 수 없습니다: ${companyId}`,
      },
    };
    return NextResponse.json(err, { status: 404 });
  }

  // idempotent: 이미 구독 중이면 기존 것 반환(회사당 1건 — @@unique([companyId])).
  const sub = await prisma.companySubscription.upsert({
    where: { companyId },
    update: {},
    create: { companyId },
  });

  const res: CreateSubscriptionResponse = toWire(sub);
  return NextResponse.json(res, { status: 201 });
}
