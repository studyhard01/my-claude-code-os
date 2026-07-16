// ============================================================================
// KakaoCareersAdapter 테스트 (OS.md 12.8 (6))
// ----------------------------------------------------------------------------
// fixture JSON 을 가짜 fetchFn 으로 주입해 "실 파싱 코드를 그대로" 태운다
// (saramin-fixture·alio-fixture 와 동일 규약). 파싱 → RawJob 정규 필드 승격 →
// normalizeRawJob 정규화 경로까지 검증한다. 실 엔드포인트 호출은 하지 않는다
// (수집 예의·네트워크 비의존 — 라이브 검증은 COLLECT_SOURCE=kakao 수동 1회).
//
// 이 어댑터의 핵심 방어선은 "조용한 폴백 금지"(12.8(6))다: 비공식 내부 API 라
// 스키마가 예고 없이 바뀔 수 있고, 그때 빈 결과를 내면 "오늘은 공고가 없네"로
// 오인된다. 그래서 구조 이상 시 throw 하는지를 명시적으로 검증한다.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COMPANY,
  KAKAO_CAREERS_URL,
  KakaoCareersAdapter,
  MAX_CALLS_PER_RUN,
  USER_AGENT,
  buildDescription,
  buildJobUrl,
  extractExperienceRaw,
  stripHtml,
} from "@/lib/collect/kakao-adapter";
import { normalizeRawJob } from "@/lib/collect/normalizer";

const FIXTURE = readFileSync(
  path.resolve(process.cwd(), "src/lib/collect/fixtures/kakao-job-list.json"),
  "utf-8",
);

/** fixture JSON 을 반환하는 가짜 fetchFn 으로 어댑터 생성 */
function fixtureAdapter() {
  const fetchFn: typeof globalThis.fetch = async () =>
    new Response(FIXTURE, { status: 200, headers: { "Content-Type": "application/json" } });
  return new KakaoCareersAdapter({ fetchFn });
}

/** 임의 응답 본문을 돌려주는 어댑터 (구조 변경 시나리오용) */
function bodyAdapter(body: unknown, status = 200) {
  const fetchFn: typeof globalThis.fetch = async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  return new KakaoCareersAdapter({ fetchFn });
}

describe("파싱 헬퍼", () => {
  it("stripHtml: <br/>→줄바꿈, 엔티티 디코딩, 제로폭공백 제거, 빈값은 undefined", () => {
    expect(stripHtml("a<br/>b")).toBe("a\nb");
    expect(stripHtml("<p>x</p><p>y</p>")).toBe("x\ny");
    expect(stripHtml("&quot;따옴표&quot;")).toBe('"따옴표"');
    expect(stripHtml("&lt;tag&gt; &amp; &#39;q&#39;")).toBe("<tag> & 'q'");
    // 실응답 introduction 에 제로폭 공백(U+200B)이 섞여 있다 — 그대로 저장하면 검색·표시가 깨진다
    expect(stripHtml("비즈니스의 ​가능성")).toBe("비즈니스의 가능성");
    expect(stripHtml("a<br/><br/><br/><br/>b")).toBe("a\n\nb"); // 과도한 빈 줄 축약
    expect(stripHtml("")).toBeUndefined();
    expect(stripHtml(undefined)).toBeUndefined();
  });

  it("stripHtml: &amp; 는 마지막에 풀어 이중 디코딩하지 않는다", () => {
    // "&amp;quot;" 는 화면에 문자 그대로 &quot; 를 보여주려는 표기 → " 로 바뀌면 안 된다
    expect(stripHtml("&amp;quot;")).toBe("&quot;");
  });

  it("extractExperienceRaw: 괄호 안 표기만 뽑고, 없으면 undefined(추정 금지)", () => {
    expect(extractExperienceRaw("Data Analytics Engineer (경력)")).toBe("경력");
    expect(extractExperienceRaw("LLM Research Engineer (Pre-training) (신입/경력)")).toBe(
      "신입/경력",
    );
    expect(extractExperienceRaw("AI Platform Engineer(경력)")).toBe("경력");
    // 공동체(S-*) 공고엔 표기가 없다 → 없는 데이터를 지어내지 않는다
    expect(extractExperienceRaw("[공동체] 카카오페이 서버 개발자 - 결제 서비스")).toBeUndefined();
    expect(extractExperienceRaw("")).toBeUndefined();
    expect(extractExperienceRaw(undefined)).toBeUndefined();
  });

  it("extractExperienceRaw: 괄호 밖 문구는 잡지 않는다(오탐 방지)", () => {
    // 제목 전체를 mapExperience 에 넘겼다면 "경력자 우대"가 EXPERIENCED 로 오판됐을 것
    expect(extractExperienceRaw("백엔드 개발자 경력자 우대")).toBeUndefined();
  });

  it("buildJobUrl: realId 로 상세 URL 조립, 없으면 채용 홈 폴백(url 은 항상 채움)", () => {
    expect(buildJobUrl("S-4707")).toBe("https://careers.kakao.com/jobs/S-4707");
    expect(buildJobUrl("P-14469")).toBe("https://careers.kakao.com/jobs/P-14469");
    expect(buildJobUrl(undefined)).toBe(KAKAO_CAREERS_URL);
  });

  it("buildDescription: introduction 본체 + '-' 플레이스홀더는 본문으로 치지 않는다", () => {
    // 실응답의 workContentDesc/qualification 은 대부분 "-" 다 → 섹션으로 넣으면 쓰레기 본문이 된다
    expect(
      buildDescription({ introduction: "조직소개<br/>내용", workContentDesc: "-", qualification: "-" }),
    ).toBe("조직소개\n내용");
    expect(
      buildDescription({ introduction: "본문", workContentDesc: "실제 업무", qualification: "-" }),
    ).toBe("본문\n\n[업무내용]\n실제 업무");
    expect(buildDescription({})).toBeUndefined();
    expect(buildDescription({ introduction: "", workContentDesc: "-" })).toBeUndefined();
  });
});

describe("KakaoCareersAdapter — 생성·수집 예의 규약", () => {
  it("인증키가 필요 없는 공개 엔드포인트라 무인자 생성이 가능하다 (saramin/alio 와 다른 점)", () => {
    expect(() => new KakaoCareersAdapter()).not.toThrow();
    expect(new KakaoCareersAdapter().source).toBe("kakao");
  });

  it("실행당 호출 상한이 보수적 규약(5콜)으로 걸려 있다 (7장 저빈도)", () => {
    expect(MAX_CALLS_PER_RUN).toBe(5);
  });

  it("User-Agent 를 명시해 요청한다 (7장 수집 예의 — 익명 위장 금지)", async () => {
    const fetchFn = vi.fn(
      async () => new Response(FIXTURE, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await new KakaoCareersAdapter({ fetchFn }).fetchRaw();

    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toContain("job-research-bot");
  });

  it("개발직군(part=TECHNOLOGY)·전 계열사(company=ALL)로 조회한다", async () => {
    const fetchFn = vi.fn(
      async () => new Response(FIXTURE, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    await new KakaoCareersAdapter({ fetchFn }).fetchRaw();

    const [url] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("part=TECHNOLOGY");
    expect(String(url)).toContain("company=ALL");
    expect(String(url)).toContain("page=1");
  });

  it("totalPage 만큼만 순회한다 (fixture totalPage=1 → 1콜)", async () => {
    let calls = 0;
    const fetchFn: typeof globalThis.fetch = async () => {
      calls += 1;
      return new Response(FIXTURE, { status: 200 });
    };
    await new KakaoCareersAdapter({ fetchFn }).fetchRaw();
    expect(calls).toBe(1);
  });

  it("totalPage 가 커도 MAX_CALLS_PER_RUN 을 넘겨 호출하지 않는다 (수집 예의 상한)", async () => {
    let calls = 0;
    const fetchFn: typeof globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ jobList: [{ realId: `X-${calls}`, jobOfferTitle: "t" }], totalPage: 999 }),
        { status: 200 },
      );
    };
    await new KakaoCareersAdapter({ fetchFn }).fetchRaw();
    expect(calls).toBe(MAX_CALLS_PER_RUN);
  });
});

describe("KakaoCareersAdapter — 조용한 폴백 금지 (12.8(6) 핵심 방어선)", () => {
  it("jobList 배열이 사라지면 빈 결과가 아니라 명확한 에러로 죽는다", async () => {
    await expect(bodyAdapter({ data: [], totalPage: 1 }).fetchRaw()).rejects.toThrow(
      /응답 구조가 기대와 다릅니다.*jobList/s,
    );
  });

  it("구조 변경 에러는 폴백 판단에 필요한 단서(원인·채용 홈 URL)를 담는다", async () => {
    await expect(bodyAdapter({ unexpected: 1 }).fetchRaw()).rejects.toThrow(
      /careers\.kakao\.com\/jobs/,
    );
  });

  it("공고를 받았는데 하나도 파싱되지 않으면(realId 소실) 에러로 죽는다", async () => {
    // "공고가 없는 것"과 "스키마가 바뀐 것"은 다르다 — 후자를 빈 배열로 넘기면 조용한 실패가 된다
    await expect(
      bodyAdapter({ jobList: [{ id: "새필드", title: "t" }], totalPage: 1 }).fetchRaw(),
    ).rejects.toThrow(/파싱 결과가 0건/);
  });

  it("첫 페이지부터 HTTP 실패면 명확한 에러를 던진다", async () => {
    await expect(bodyAdapter("blocked", 403).fetchRaw()).rejects.toThrow(/HTTP 403/);
  });

  it("jobList 가 정상적으로 비어 있으면(공고 없음) 에러가 아니라 빈 배열 + 경고", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raws = await bodyAdapter({ jobList: [], totalJobCount: 0, totalPage: 1 }).fetchRaw();
    expect(raws).toEqual([]);
    expect(warn).toHaveBeenCalled(); // 조용히 넘기지는 않는다
    warn.mockRestore();
  });
});

describe("KakaoCareersAdapter — fixture 파싱·필드 매핑", () => {
  it("fixture 9건 중 realId 없는 1건을 건너뛰고 8건을 RawJob 으로 파싱한다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raws = await fixtureAdapter().fetchRaw();

    expect(raws).toHaveLength(8); // realId 없는 1건 제외
    expect(raws.every((r) => r.source === "kakao")).toBe(true);
    // [12.8(6)] url 은 전 건 필수 — 전부 공고 상세 페이지로 조립된다
    expect(raws.every((r) => r.url.startsWith("https://careers.kakao.com/jobs/"))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("realId"), expect.any(String));
    warn.mockRestore();
  });

  it("필드 매핑: 정규 필드 승격(jobRoleName=제목+jobPartName 결합, locationName), 본문 정제", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const first = raws[0]; // P-14276 Data Analytics Engineer (경력)

    expect(first.sourceJobId).toBe("P-14276");
    expect(first.url).toBe("https://careers.kakao.com/jobs/P-14276");
    expect(first.companyName).toBe("카카오");
    expect(first.title).toBe("Data Analytics Engineer (경력)");
    expect(first.jobRoleName).toContain("Data Analytics"); // 제목의 구체 직무
    expect(first.jobRoleName).toContain("테크"); // jobPartName(coarse)도 결합
    expect(first.jobRoleCode).toBe("TECHNOLOGY"); // 코드 원문 보존
    expect(first.locationName).toBe("판교");
    expect(first.experienceRaw).toBe("경력"); // 응답에 경력 필드가 없어 제목에서 추출
    expect(first.employmentType).toBe("정규직");
    expect(first.postedAt).toBeDefined();
    expect(first.description).toBeDefined();
    expect(first.description).not.toContain("<br"); // HTML 태그가 남지 않는다
    expect(first.raw.companyCodeId).toBeDefined(); // A-3 원본 보존(M2 회사 연결 힌트)
  });

  it("계열사 공고는 companyName 에 계열사명이 들어간다 (본사 '카카오'와 구분)", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    expect(raws[3].companyName).toBe("카카오페이");
    expect(raws[4].companyName).toBe("카카오모빌리티");
  });

  it("계열사 필드가 비면 '카카오'로 폴백한다 (12.8(6))", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const noCompany = raws.find((r) => r.sourceJobId === "S-9002");
    expect(noCompany?.companyName).toBe(DEFAULT_COMPANY);
  });

  it("[실측] endDate 가 전 건 null 이라 deadline 은 undefined(상시채용)", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    // OS.md 12.8(6) 의 "마감일 포함" 서술과 달리 실응답 28건 전부 endDate=null 이었다.
    // 12.8(2) 상 PARTIAL 사유는 아니지만, 기본 정렬(deadline)에서 전부 뒤로 밀린다.
    expect(raws.every((r) => r.deadline === undefined)).toBe(true);
  });

  it("[실측] 공동체(S-*) 공고는 locationName 이 비어 있다", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    expect(raws[0].locationName).toBe("판교"); // 본사(P-*)
    expect(raws[3].locationName).toBeUndefined(); // 공동체(S-*) — 추정해 채우지 않는다
  });
});

describe("KakaoCareersAdapter → normalizeRawJob 정규화 경로 (파이프라인 고정 규약)", () => {
  it("fixture 정규화 결과: FULL 3건 + PARTIAL 5건", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const outs = raws.map(normalizeRawJob);
    expect(outs.filter((o) => o.dataQuality === "FULL")).toHaveLength(3);
    expect(outs.filter((o) => o.dataQuality === "PARTIAL")).toHaveLength(5);
  });

  it("FULL: 영문 직무명 → data 매핑, 판교 → 경기, 제목 경력표기 → EXPERIENCED", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[0]); // Data Analytics Engineer (경력)

    expect(out.dataQuality).toBe("FULL");
    expect(out.source).toBe("kakao");
    expect(out.jobRole).toBe("data"); // 영문 키워드 보강이 없었으면 null 이었다
    expect(out.location).toBe("경기"); // "판교" → 경기(성남) 매핑
    expect(out.experienceLevel).toBe("EXPERIENCED");
    expect(out.deadline).toBeNull(); // 상시채용 — PARTIAL 사유 아님(12.8(2))
    expect(out.description).toBeTruthy(); // 사람인 약점(본문 부재) 보완
    expect(out.dedupKey).toBe("카카오|data|경기");
  });

  it("FULL: '신입/경력' 표기 → ANY (신입 단독으로 오판하지 않음)", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[1]); // LLM Research Engineer (Pre-training) (신입/경력)

    expect(out.dataQuality).toBe("FULL");
    expect(out.jobRole).toBe("data"); // "llm" 키워드
    expect(out.experienceLevel).toBe("ANY");
  });

  it("FULL: 'Machine Learning' 영문 표기도 data 로 매핑된다", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[2]);
    expect(out.dataQuality).toBe("FULL");
    expect(out.jobRole).toBe("data");
  });

  it("PARTIAL: 공동체 공고는 지역·경력이 응답에 없어 PARTIAL (직무는 붙는다)", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[3]); // 카카오페이 서버 개발자

    expect(out.dataQuality).toBe("PARTIAL");
    expect(out.jobRole).toBe("backend"); // "서버 개발자" → 조건 필터는 걸린다(이 어댑터의 핵심 가치)
    expect(out.location).toBeNull();
    expect(out.experienceLevel).toBe("ANY"); // 미해석 시 기본값(12.8(2))
    expect(out.url).toBe("https://careers.kakao.com/jobs/S-4729"); // 원문 진입점은 보존
    expect(out.dedupKey).toBe("카카오페이|backend|");
  });

  it("PARTIAL: 7개 개발직군 밖(QA)은 jobRole null", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[5]); // 서비스/플랫폼 QA 담당자 (경력)

    expect(out.dataQuality).toBe("PARTIAL");
    expect(out.jobRole).toBeNull();
    expect(out.location).toBe("경기"); // 나머지 필드는 유지
    expect(out.experienceLevel).toBe("EXPERIENCED");
  });

  it("PARTIAL: title 누락은 placeholder 로 대체 저장", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws.find((r) => r.sourceJobId === "S-9001")!);

    expect(out.dataQuality).toBe("PARTIAL");
    expect(out.title).toBe("(제목 미확인 공고)");
    expect(out.url).toBe("https://careers.kakao.com/jobs/S-9001"); // 원문으로 확인 유도
  });
});
