// ============================================================================
// npm run collect — 수집 실행 진입점 (OS.md 12.2/12.7: M1 = 수동 실행)
// ----------------------------------------------------------------------------
// 파이프라인(12.8 (4) 고정):
//   adapter.fetchRaw() → normalizeRawJob() → prisma.job.upsert((source, sourceJobId))
//     → 수집 요약 로그(총·FULL·PARTIAL·신규/갱신)
//
// 수집 소스 스위치:
//   COLLECT_SOURCE = mock(기본) | saramin-fixture | saramin | alio-fixture | alio
//                    | kakao-fixture | kakao
//   - mock            : MockAdapter (day-1, 승인 전 기본값)
//   - saramin-fixture : SaraminAdapter + 로컬 fixture 를 반환하는 가짜 fetchFn
//                       → 실 파싱·정규화·upsert 경로 전체를 승인 전에 검증
//   - saramin         : 실 API 호출. SARAMIN_ACCESS_KEY 필수(없으면 즉시 에러,
//                       조용한 폴백 금지 — 12.8)
//   - alio-fixture    : AlioAdapter + 로컬 JSON fixture (실 파싱·정규화·upsert 경로 검증)
//   - alio            : 잡알리오 실 API. ALIO_API_KEY 필수(동일 규약 — 12.8(5))
//   - kakao-fixture   : KakaoCareersAdapter + 로컬 JSON fixture (동일 규약)
//   - kakao           : 카카오 자체 채용 공개 JSON. 인증키 불필요(공개 엔드포인트)라
//                       키 검사가 없다 — 대신 비공식 내부 API 라 응답 구조가 바뀌면
//                       어댑터가 명확한 에러로 죽는다(12.8(6))
//
// upsert 는 (source, sourceJobId) UNIQUE 키 기준 → 재실행 시 중복 생성 없음(idempotent).
// 날짜: Normalizer 는 ISO "문자열"을 반환하고, Date 변환은 여기(수집 진입점) 책임(12.8).
//
// [M2 위생 — 2026-07-19] 이미 마감 지난 공고는 upsert 전에 거른다(만료 스킵).
//   경계는 피드와 동일(src/lib/collect/expiry.ts 참조). 잡알리오 라이브 실측
//   (500건 중 마감 전 61건)이 근거 — 만료 공고가 DB 만 불리고 피드엔 안 보인다.
//   이미 DB 에 있는 공고가 만료 후 재수집되면 갱신도 스킵된다(피드가 어차피
//   숨기므로 낡은 채 남아도 무해, 삭제는 하지 않는다).
//   COLLECT_NOW(ISO) 로 판정 기준 시각을 주입할 수 있다 — 테스트가 fixture
//   채집 시점으로 시간을 고정해 "달력이 넘어가면 저절로 깨지는 테스트"(평가
//   게이트 C3 사고와 같은 유형)를 막기 위한 것. 실행 시엔 지정하지 않는다.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { MockAdapter, type SourceAdapter } from "../src/lib/collect/source-adapter";
import { SaraminAdapter } from "../src/lib/collect/saramin-adapter";
import { AlioAdapter } from "../src/lib/collect/alio-adapter";
import { KakaoCareersAdapter } from "../src/lib/collect/kakao-adapter";
import { normalizeRawJob } from "../src/lib/collect/normalizer";
import { isExpiredDeadline } from "../src/lib/collect/expiry";

const prisma = new PrismaClient();

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "src/lib/collect/fixtures/saramin-job-search.json",
);
const ALIO_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "src/lib/collect/fixtures/alio-recruitment-list.json",
);
const KAKAO_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "src/lib/collect/fixtures/kakao-job-list.json",
);

/** fixture JSON 을 그대로 반환하는 가짜 fetchFn — 어댑터의 실 파싱 코드를 그대로 태운다 */
function fixtureFetch(fixturePath: string): typeof globalThis.fetch {
  const body = readFileSync(fixturePath, "utf-8");
  return async () =>
    new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
}

/** COLLECT_SOURCE 값으로 어댑터 선택 (12.8 (4)) */
function buildAdapter(): SourceAdapter {
  const mode = process.env.COLLECT_SOURCE ?? "mock";

  switch (mode) {
    case "mock":
      return new MockAdapter();

    case "saramin-fixture":
      // 가짜 fetchFn 이 fixture JSON 을 반환 → SaraminAdapter 의 실 파싱 코드를 그대로 태운다.
      return new SaraminAdapter({ accessKey: "fixture-key", fetchFn: fixtureFetch(FIXTURE_PATH) });

    case "saramin": {
      const accessKey = process.env.SARAMIN_ACCESS_KEY;
      if (!accessKey) {
        // 조용한 폴백 금지(12.8): mock 으로 몰래 넘어가지 않고 명확히 실패시킨다.
        throw new Error(
          "[collect] COLLECT_SOURCE=saramin 인데 SARAMIN_ACCESS_KEY 가 없습니다. " +
            "사람인 개발자센터 승인 후 발급받은 키를 환경변수로 설정하세요. " +
            "(승인 전 검증은 COLLECT_SOURCE=saramin-fixture 사용)",
        );
      }
      return new SaraminAdapter({ accessKey });
    }

    case "alio-fixture":
      // 가짜 fetchFn 이 JSON fixture 를 반환 → AlioAdapter 의 실 파싱 코드를 그대로 태운다.
      return new AlioAdapter({ apiKey: "fixture-key", fetchFn: fixtureFetch(ALIO_FIXTURE_PATH) });

    case "alio": {
      const apiKey = process.env.ALIO_API_KEY;
      if (!apiKey) {
        // 조용한 폴백 금지(12.8(5)): saramin 과 동일 규약.
        throw new Error(
          "[collect] COLLECT_SOURCE=alio 인데 ALIO_API_KEY 가 없습니다. " +
            "공공데이터포털에서 잡알리오 채용정보 API 활용신청(자동승인) 후 키를 설정하세요. " +
            "(키 발급 전 검증은 COLLECT_SOURCE=alio-fixture 사용)",
        );
      }
      return new AlioAdapter({ apiKey });
    }

    case "kakao-fixture":
      return new KakaoCareersAdapter({ fetchFn: fixtureFetch(KAKAO_FIXTURE_PATH) });

    case "kakao":
      // 인증키가 없는 공개 엔드포인트 → saramin/alio 같은 키 검사가 없다(12.8(6)).
      // "조용한 폴백 금지"는 키가 아니라 응답 구조 검증으로 지켜진다(어댑터 assertKakaoBody).
      return new KakaoCareersAdapter();

    default:
      throw new Error(
        `[collect] 알 수 없는 COLLECT_SOURCE: "${mode}" ` +
          "(mock | saramin-fixture | saramin | alio-fixture | alio | kakao-fixture | kakao)",
      );
  }
}

/** 만료 판정 기준 시각. COLLECT_NOW 가 있으면 그 시각(잘못된 값은 즉시 실패 — 조용한 폴백 금지) */
function resolveNow(): Date {
  const raw = process.env.COLLECT_NOW;
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`[collect] COLLECT_NOW 를 해석할 수 없습니다: "${raw}" (ISO 형식 필요)`);
  }
  return d;
}

async function main() {
  const mode = process.env.COLLECT_SOURCE ?? "mock";
  const adapter = buildAdapter();
  const now = resolveNow();

  console.log(`[collect] mode=${mode} source=${adapter.source} 수집 시작`);
  const raws = await adapter.fetchRaw();
  console.log(`[collect] fetchRaw: ${raws.length}건 수신`);

  let full = 0;
  let partial = 0;
  let created = 0;
  let updated = 0;
  let expiredSkipped = 0;

  for (const raw of raws) {
    const input = normalizeRawJob(raw);

    // 만료 스킵(M2 위생) — 마감 지난 공고는 적재도 갱신도 하지 않는다.
    if (isExpiredDeadline(input.deadline, now)) {
      expiredSkipped += 1;
      continue;
    }

    if (input.dataQuality === "PARTIAL") partial += 1;
    else full += 1;

    // ISO 문자열 → Date 변환은 수집 진입점 책임(12.8). collectedAt 은 재수집 시각으로 갱신.
    const data = {
      url: input.url,
      title: input.title,
      companyName: input.companyName,
      jobRole: input.jobRole,
      location: input.location,
      experienceLevel: input.experienceLevel,
      employmentType: input.employmentType,
      deadline: input.deadline ? new Date(input.deadline) : null,
      postedAt: input.postedAt ? new Date(input.postedAt) : null,
      description: input.description,
      dataQuality: input.dataQuality,
      dedupKey: input.dedupKey,
      rawData: input.rawData,
      collectedAt: new Date(),
    };

    // 신규/갱신 집계용 존재 확인 (M1 수십 건 규모 — 정확성 우선, 성능 최적화는 불필요)
    const existing = await prisma.job.findUnique({
      where: {
        source_sourceJobId: { source: input.source, sourceJobId: input.sourceJobId },
      },
      select: { id: true },
    });

    await prisma.job.upsert({
      where: {
        source_sourceJobId: { source: input.source, sourceJobId: input.sourceJobId },
      },
      update: data,
      create: { source: input.source, sourceJobId: input.sourceJobId, ...data },
    });

    if (existing) updated += 1;
    else created += 1;
  }

  const dbTotal = await prisma.job.count();
  console.log(
    `[collect] 완료 — 수집 ${raws.length}건 (FULL ${full} / PARTIAL ${partial}) · ` +
      `만료 스킵 ${expiredSkipped} · 신규 ${created} / 갱신 ${updated} · DB Job 총 ${dbTotal}건`,
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
