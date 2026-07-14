// ============================================================================
// AlioAdapter 테스트 (OS.md 12.8 (5))
// ----------------------------------------------------------------------------
// fixture JSON 을 가짜 fetchFn 으로 주입해 "실 파싱 코드를 그대로" 태운다
// (saramin-fixture 와 동일 규약). 파싱 → RawJob 정규 필드 승격 → normalizeRawJob
// 정규화 경로까지 검증한다. 실 API 실호출은 하지 않는다(쿼터 보호·네트워크 비의존).
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AlioAdapter,
  MAX_CALLS_PER_RUN,
  buildDescription,
  normalizeSrcUrl,
  toDateString,
} from "@/lib/collect/alio-adapter";
import { normalizeRawJob } from "@/lib/collect/normalizer";

const FIXTURE = readFileSync(
  path.resolve(process.cwd(), "src/lib/collect/fixtures/alio-recruitment-list.json"),
  "utf-8",
);

/** fixture JSON 을 반환하는 가짜 fetchFn 으로 어댑터 생성 */
function fixtureAdapter() {
  const fetchFn: typeof globalThis.fetch = async () =>
    new Response(FIXTURE, { status: 200, headers: { "Content-Type": "application/json" } });
  return new AlioAdapter({ apiKey: "test-key", fetchFn });
}

describe("파싱 헬퍼", () => {
  it("toDateString: YYYYMMDD/구분자 표기를 YYYY-MM-DD 로, 비정상·빈값은 undefined", () => {
    expect(toDateString("20260820")).toBe("2026-08-20");
    expect(toDateString("2026-08-20")).toBe("2026-08-20");
    expect(toDateString("2026.08.20")).toBe("2026-08-20");
    expect(toDateString("")).toBeUndefined();
    expect(toDateString("20261399")).toBeUndefined(); // 월/일 범위 밖
    expect(toDateString(undefined)).toBeUndefined();
  });

  it("normalizeSrcUrl: http 유지·스킴없는 도메인 보정·정크는 ALIO 목록 폴백", () => {
    expect(normalizeSrcUrl("https://a.kr/x")).toBe("https://a.kr/x");
    expect(normalizeSrcUrl("www.knudh.kr")).toBe("https://www.knudh.kr");
    // 정크(., 없음, 해당없음, -, 빈값)는 계약상 url 을 비울 수 없으므로 ALIO 목록 페이지 폴백
    for (const junk of [".", "없음", "해당없음", "-", "/", ",", "", undefined]) {
      expect(normalizeSrcUrl(junk)).toBe("https://job.alio.go.kr/recruit.do");
    }
  });

  it("buildDescription: 지원자격+우대+전형 결합, 전부 비면 undefined", () => {
    expect(
      buildDescription({ aplyQlfcCn: "자격A", prefCn: "우대B", scrnprcdrMthdExpln: "전형C" }),
    ).toBe("[지원자격]\n자격A\n\n[우대사항]\n우대B\n\n[전형방법]\n전형C");
    expect(buildDescription({})).toBeUndefined();
    expect(buildDescription({ prefCn: "" })).toBeUndefined(); // 빈 문자열은 섹션 아님
  });
});

describe("AlioAdapter — 생성·fetchRaw 규약", () => {
  it("apiKey 가 비어 있으면 생성 자체가 실패한다 (조용한 폴백 금지, 12.8)", () => {
    expect(() => new AlioAdapter({ apiKey: "" })).toThrow(/ALIO_API_KEY/);
  });

  it("HTTP 실패 시(수집분 0건) 명확한 에러를 던진다", async () => {
    const fetchFn: typeof globalThis.fetch = async () => new Response("err", { status: 500 });
    const adapter = new AlioAdapter({ apiKey: "k", fetchFn });
    await expect(adapter.fetchRaw()).rejects.toThrow(/HTTP 500/);
  });

  it("실행당 호출 상한이 saramin 과 동일한 보수적 규약(5콜)으로 걸려 있다", () => {
    expect(MAX_CALLS_PER_RUN).toBe(5);
  });

  it("fixture 6건을 RawJob 으로 파싱한다 (source=alio, 마지막 페이지 판정으로 1콜 종료)", async () => {
    let calls = 0;
    const fetchFn: typeof globalThis.fetch = async () => {
      calls += 1;
      return new Response(FIXTURE, { status: 200 });
    };
    const adapter = new AlioAdapter({ apiKey: "k", fetchFn });
    const raws = await adapter.fetchRaw();

    expect(calls).toBe(1); // 6건 < numOfRows 100 → 마지막 페이지, 추가 호출 없음
    expect(raws).toHaveLength(6);
    expect(raws.every((r) => r.source === "alio")).toBe(true);
    expect(raws.every((r) => r.url.length > 0)).toBe(true); // url 은 항상 채움(계약)
  });

  it("필드 매핑: 정규 필드 승격(jobRoleName=제목+NCS 결합, locationName), 본문 결합", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const first = raws[0];

    expect(first.sourceJobId).toBe("310001"); // number → 문자열화
    expect(first.companyName).toBe("한국지능정보사회진흥원");
    expect(first.title).toBe("2026년 한국지능정보사회진흥원 백엔드 개발자(정규직) 채용 공고");
    expect(first.jobRoleName).toContain("백엔드"); // 제목의 구체 직무가 결합됨
    expect(first.jobRoleName).toContain("정보통신"); // NCS 분류도 결합
    expect(first.jobRoleCode).toBe("R600020"); // 코드 원문 보존
    expect(first.locationName).toBe("서울");
    expect(first.experienceRaw).toBe("신입");
    expect(first.deadline).toBe("2026-08-20"); // YYYYMMDD → YYYY-MM-DD
    expect(first.postedAt).toBe("2026-07-10");
    expect(first.description).toContain("[지원자격]"); // 사람인과 달리 본문 채움(12.8(5))
    expect(first.description).toContain("[전형방법]");
    expect(first.raw.acbgCondNmLst).toBe("대졸"); // A-3 원본 보존
  });

  it("srcUrl 정크('없음')는 ALIO 폴백 URL 로, 스킴없는 도메인은 https 보정", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    expect(raws[3].url).toBe("https://job.alio.go.kr/recruit.do"); // "없음"
    expect(raws[5].url).toBe("https://www.knudh.kr"); // "www.knudh.kr"
  });

  it("마감 비정상(빈값)은 deadline undefined, 본문 없으면 description undefined", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    expect(raws[4].deadline).toBeUndefined(); // pbancEndYmd ""
    expect(raws[5].description).toBeUndefined(); // 본문 필드 전무
  });
});

describe("AlioAdapter → normalizeRawJob 정규화 경로 (파이프라인 고정 규약)", () => {
  it("fixture 정규화 결과: FULL 3건 + PARTIAL 3건", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const outs = raws.map(normalizeRawJob);
    expect(outs.filter((o) => o.dataQuality === "FULL")).toHaveLength(3);
    expect(outs.filter((o) => o.dataQuality === "PARTIAL")).toHaveLength(3);
  });

  it("FULL: 제목 결합으로 backend 매핑·서울·NEW, description 채움, dedupKey 규칙", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[0]);

    expect(out.dataQuality).toBe("FULL");
    expect(out.source).toBe("alio");
    expect(out.jobRole).toBe("backend"); // 제목 "백엔드 개발자" 키워드 매핑
    expect(out.location).toBe("서울");
    expect(out.experienceLevel).toBe("NEW");
    expect(out.description).toContain("Spring");
    expect(out.dedupKey).toBe("한국지능정보사회진흥원|backend|서울");
  });

  it("FULL: recrutSeNm '신입+경력' → ANY (신입 단독으로 오판하지 않음)", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[2]); // 프론트엔드, 서울/대전, 신입+경력

    expect(out.dataQuality).toBe("FULL");
    expect(out.jobRole).toBe("frontend");
    expect(out.location).toBe("서울"); // 다중 지역 첫 매칭
    expect(out.experienceLevel).toBe("ANY"); // "신입+경력" — 12.8(5) 매핑
  });

  it("(주) 표기 회사도 dedupKey normCompany 규칙 적용 + data 매핑", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[1]);

    expect(out.dataQuality).toBe("FULL");
    expect(out.jobRole).toBe("data"); // 제목 "데이터 엔지니어"
    expect(out.experienceLevel).toBe("EXPERIENCED"); // "경력"
    expect(out.dedupKey).toBe("한국데이터산업진흥원|data|경기"); // (주) 제거
  });

  it("PARTIAL: 비개발 직무(제목 미매핑) → jobRole null, 상시(빈 마감)은 PARTIAL 사유 아님", async () => {
    const raws = await fixtureAdapter().fetchRaw();

    const clerical = normalizeRawJob(raws[3]); // 사무보조원 + srcUrl "없음"
    expect(clerical.dataQuality).toBe("PARTIAL");
    expect(clerical.jobRole).toBeNull();
    expect(clerical.location).toBe("서울"); // 나머지 필드는 유지
    expect(clerical.url).toContain("job.alio.go.kr"); // 폴백 URL 로 원문 진입점 보존

    const unmappedRegion = normalizeRawJob(raws[4]); // 전북(미매핑) + 빈 마감
    expect(unmappedRegion.dataQuality).toBe("PARTIAL");
    expect(unmappedRegion.location).toBeNull();
    expect(unmappedRegion.deadline).toBeNull(); // 빈 마감 → 상시(그 자체론 PARTIAL 아님)
  });
});
