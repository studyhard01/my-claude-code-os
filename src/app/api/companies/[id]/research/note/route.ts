// ============================================================================
// PUT    /api/companies/:id/research/note { content } — 노트 upsert (OS.md 12.11)
// DELETE /api/companies/:id/research/note            — 노트 삭제 → 204
// ----------------------------------------------------------------------------
// 회사당 노트 1개(@@unique([companyId])). PUT 은 idempotent — 있으면 갱신, 없으면 생성.
//   빈/공백 content = 노트 삭제(= DELETE 와 동일 효과). 삭제 후에도 200 { note: null }.
//   없는 회사 → 404 COMPANY_NOT_FOUND, 잘못된 body → 400 INVALID_BODY (12.5).
//
// [DELETE 멱등 규약] 이 라우트의 삭제 대상은 note id 가 아니라 "회사(companyId)의
//   싱글턴 노트"다. Bookmark DELETE(자기 id 로 특정 리소스 지목 → 없으면 404)와 달리,
//   여기선 회사만 존재하면 "노트 없음"도 성공(204)으로 본다 — PUT 빈 content 삭제와
//   같은 "노트가 없는 상태를 보장" 의미라 내부 일관성을 위해 멱등 204 로 통일.
//   (회사 자체가 없으면 404 COMPANY_NOT_FOUND — 존재 확인은 유지.)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type {
  ApiError,
  ResearchNote,
  ResearchNoteResponse,
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

/** 회사 존재 확인 → 없으면 404 ApiError 응답, 있으면 null */
async function ensureCompany(id: string): Promise<NextResponse | null> {
  const company = await prisma.company.findUnique({ where: { id } });
  if (company) return null;
  const err: ApiError = {
    error: {
      code: "COMPANY_NOT_FOUND",
      message: `회사를 찾을 수 없습니다: ${id}`,
    },
  };
  return NextResponse.json(err, { status: 404 });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const notFound = await ensureCompany(id);
  if (notFound) return notFound;

  let content: unknown;
  try {
    ({ content } = (await req.json()) as { content?: unknown });
  } catch {
    content = undefined;
  }

  if (typeof content !== "string") {
    const err: ApiError = {
      error: { code: "INVALID_BODY", message: "content(문자열)가 필요합니다." },
    };
    return NextResponse.json(err, { status: 400 });
  }

  const trimmed = content.trim();

  // 빈/공백 content = 삭제(idempotent — 노트 없어도 무해). Bookmark DELETE 계열 P2025 회피 위해 deleteMany.
  if (trimmed === "") {
    await prisma.researchNote.deleteMany({ where: { companyId: id } });
    const res: ResearchNoteResponse = { note: null };
    return NextResponse.json(res);
  }

  const note = await prisma.researchNote.upsert({
    where: { companyId: id },
    update: { content: trimmed },
    create: { companyId: id, content: trimmed },
  });
  const res: ResearchNoteResponse = { note: noteToWire(note) };
  return NextResponse.json(res);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const notFound = await ensureCompany(id);
  if (notFound) return notFound;

  // 멱등 — 노트가 없어도 204(위 규약 메모 참조). deleteMany 는 미존재 시 count 0 만.
  await prisma.researchNote.deleteMany({ where: { companyId: id } });
  return new NextResponse(null, { status: 204 });
}
