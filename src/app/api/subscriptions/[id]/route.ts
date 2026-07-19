// ============================================================================
// DELETE /api/subscriptions/:id — 구독 해제 → 204 (OS.md 12.9, M2a 조각 ②)
// ----------------------------------------------------------------------------
// 없는 id → 404 SUBSCRIPTION_NOT_FOUND (12.5 ApiError 계약, Bookmark DELETE 패턴).
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ApiError } from "@/types/contract";

/** Prisma "레코드 없음"(P2025) 판별 */
function isNotFound(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2025"
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.companySubscription.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (isNotFound(e)) {
      const err: ApiError = {
        error: {
          code: "SUBSCRIPTION_NOT_FOUND",
          message: `구독을 찾을 수 없습니다: ${id}`,
        },
      };
      return NextResponse.json(err, { status: 404 });
    }
    throw e;
  }
}
