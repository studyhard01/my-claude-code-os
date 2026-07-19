// ============================================================================
// npm run db:backfill-companies — 기존 Job 행 회사 연결 일괄 채움 (12.9 조각 ①)
// ----------------------------------------------------------------------------
// 규칙은 수집 경로(scripts/collect.ts)와 동일 — normCompany(normalizeCompanyName)
// 매칭 재사용(12.9 확정). idempotent:
//   - companyId 가 이미 있는 행은 건드리지 않는다
//   - placeholder "(회사 미확인)" 행은 연결하지 않는다(null 유지)
//   - Company 는 normName UNIQUE upsert → 재실행해도 중복 생성 0
// 1회성 마이그레이션 성격이지만 재실행이 무해하므로 스크립트로 남겨 둔다
// (이후 다른 소스 편입 시 재사용 가능).
// ============================================================================

import { PrismaClient } from "@prisma/client";
import {
  COMPANY_PLACEHOLDER,
  normalizeCompanyName,
} from "../src/lib/collect/normalizer";

const prisma = new PrismaClient();

async function main() {
  const targets = await prisma.job.findMany({
    where: { companyId: null, companyName: { not: COMPANY_PLACEHOLDER } },
    select: { id: true, companyName: true },
  });
  const skippedPlaceholder = await prisma.job.count({
    where: { companyId: null, companyName: COMPANY_PLACEHOLDER },
  });
  console.log(
    `[backfill] 대상 ${targets.length}건 (placeholder 제외 ${skippedPlaceholder}건)`,
  );

  const companiesBefore = await prisma.company.count();
  const idByNorm = new Map<string, string>();
  let linked = 0;

  for (const job of targets) {
    const normName = normalizeCompanyName(job.companyName);
    if (!normName) continue;

    let companyId = idByNorm.get(normName);
    if (!companyId) {
      const company = await prisma.company.upsert({
        where: { normName },
        update: {}, // name 은 최초 관측 원문 유지(12.9)
        create: { name: job.companyName, normName },
        select: { id: true },
      });
      companyId = company.id;
      idByNorm.set(normName, companyId);
    }

    await prisma.job.update({ where: { id: job.id }, data: { companyId } });
    linked += 1;
  }

  const companiesAfter = await prisma.company.count();
  const stillNull = await prisma.job.count({ where: { companyId: null } });
  console.log(
    `[backfill] 완료 — 연결 ${linked}건 · 신규 회사 ${companiesAfter - companiesBefore}곳 ` +
      `(총 ${companiesAfter}곳) · companyId null 잔존 ${stillNull}건(placeholder 등)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
