// ============================================================================
// WorknetAdapter 테스트 (OS.md 12.8 (5))
// ----------------------------------------------------------------------------
// fixture XML 을 가짜 fetchFn 으로 주입해 "실 파싱 코드를 그대로" 태운다
// (saramin-fixture 와 동일 규약). 파싱 → RawJob 정규 필드 승격 → normalizeRawJob
// 정규화 경로까지 검증한다.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_CALLS_PER_RUN,
  WorknetAdapter,
  extractItems,
  extractTag,
  toDateString,
} from "@/lib/collect/worknet-adapter";
import { COMPANY_PLACEHOLDER, normalizeRawJob } from "@/lib/collect/normalizer";

const FIXTURE = readFileSync(
  path.resolve(process.cwd(), "src/lib/collect/fixtures/worknet-wanted-list.xml"),
  "utf-8",
);

/** fixture XML 을 반환하는 가짜 fetchFn 으로 어댑터 생성 */
function fixtureAdapter() {
  const fetchFn: typeof globalThis.fetch = async () =>
    new Response(FIXTURE, { status: 200, headers: { "Content-Type": "application/xml" } });
  return new WorknetAdapter({ apiKey: "test-key", fetchFn });
}

describe("XML 파싱 헬퍼 (외부 라이브러리 없이, 방어적)", () => {
  it("extractTag: 일반 텍스트·CDATA·엔티티를 처리하고, 빈 값·부재는 undefined", () => {
    expect(extractTag("<a>hello</a>", "a")).toBe("hello");
    expect(extractTag("<a><![CDATA[x < y & z]]></a>", "a")).toBe("x < y & z");
    expect(extractTag("<a>A&amp;B</a>", "a")).toBe("A&B");
    expect(extractTag("<a>  </a>", "a")).toBeUndefined();
    expect(extractTag("<b>x</b>", "a")).toBeUndefined();
  });

  it("extractTag: 접두 태그(wantedAuthNo)가 wanted 매칭에 오염되지 않는다", () => {
    const xml = "<wanted><wantedAuthNo>K1</wantedAuthNo></wanted>";
    expect(extractTag(xml, "wanted")).toBe("<wantedAuthNo>K1</wantedAuthNo>");
    expect(extractTag(xml, "wantedAuthNo")).toBe("K1");
  });

  it("extractItems: fixture 에서 <wanted> 블록 6개를 분리한다", () => {
    expect(extractItems(FIXTURE)).toHaveLength(6);
  });

  it("toDateString: YYYYMMDD/구분자 표기를 수용, 비날짜('채용시까지')는 undefined", () => {
    expect(toDateString("20260731")).toBe("2026-07-31");
    expect(toDateString("2026-07-31")).toBe("2026-07-31");
    expect(toDateString("2026.07.31")).toBe("2026-07-31");
    expect(toDateString("채용시까지")).toBeUndefined();
    expect(toDateString(undefined)).toBeUndefined();
  });
});

describe("WorknetAdapter — 생성·fetchRaw 규약", () => {
  it("apiKey 가 비어 있으면 생성 자체가 실패한다 (조용한 폴백 금지, 12.8)", () => {
    expect(() => new WorknetAdapter({ apiKey: "" })).toThrow(/WORKNET_API_KEY/);
  });

  it("HTTP 실패 시(수집분 0건) 명확한 에러를 던진다", async () => {
    const fetchFn: typeof globalThis.fetch = async () => new Response("err", { status: 500 });
    const adapter = new WorknetAdapter({ apiKey: "k", fetchFn });
    await expect(adapter.fetchRaw()).rejects.toThrow(/HTTP 500/);
  });

  it("실행당 호출 상한이 saramin 과 동일한 보수적 규약(5콜)으로 걸려 있다", () => {
    expect(MAX_CALLS_PER_RUN).toBe(5);
  });

  it("fixture 6건을 RawJob 으로 파싱한다 (source=worknet, 마지막 페이지 판정으로 1콜 종료)", async () => {
    let calls = 0;
    const fetchFn: typeof globalThis.fetch = async () => {
      calls += 1;
      return new Response(FIXTURE, { status: 200 });
    };
    const adapter = new WorknetAdapter({ apiKey: "k", fetchFn });
    const raws = await adapter.fetchRaw();

    expect(calls).toBe(1); // 6건 < display 100 → 마지막 페이지로 판정, 추가 호출 없음
    expect(raws).toHaveLength(6);
    expect(raws.every((r) => r.source === "worknet")).toBe(true);
    expect(raws.every((r) => r.url.length > 0)).toBe(true); // url 은 항상 채움(계약)
  });

  it("FULL 케이스: 정규 필드 승격(jobRoleName/locationName)과 description 채움", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const first = raws[0];

    expect(first.sourceJobId).toBe("K151812607140001");
    expect(first.companyName).toBe("(주)한빛소프트웍스");
    expect(first.title).toBe("백엔드 개발자(Java/Spring) 신입 채용"); // CDATA 해제
    expect(first.jobRoleName).toBe("웹 개발자(백엔드)"); // 소스 구조 해석은 어댑터 책임
    expect(first.locationName).toBe("서울 구로구");
    expect(first.experienceRaw).toBe("신입");
    expect(first.deadline).toBe("2026-08-20");
    expect(first.description).toContain("Spring Boot"); // 본문성 텍스트 있으면 채움(12.8(5))
    expect(first.raw.xml).toContain("<wantedAuthNo>K151812607140001</wantedAuthNo>"); // A-3 원본 보존

    const second = raws[1];
    expect(second.companyName).toBe("미래아이티&컴즈"); // &amp; 엔티티 디코딩
    expect(second.description).toBeUndefined(); // jobCont 없음 → normalize 후 null
  });

  it("상시채용('채용시까지')은 deadline undefined 로 남긴다", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    expect(raws[2].deadline).toBeUndefined();
  });
});

describe("WorknetAdapter → normalizeRawJob 정규화 경로 (파이프라인 고정 규약)", () => {
  it("fixture 정규화 결과: FULL 3건 + PARTIAL 3건", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const outs = raws.map(normalizeRawJob);
    expect(outs.filter((o) => o.dataQuality === "FULL")).toHaveLength(3);
    expect(outs.filter((o) => o.dataQuality === "PARTIAL")).toHaveLength(3);
  });

  it("FULL: 백엔드·서울·NEW, description 채움, dedupKey 규칙 적용", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[0]);

    expect(out.dataQuality).toBe("FULL");
    expect(out.source).toBe("worknet");
    expect(out.jobRole).toBe("backend"); // jobsNm "웹 개발자(백엔드)" 키워드 매핑
    expect(out.location).toBe("서울"); // region "서울 구로구"
    expect(out.experienceLevel).toBe("NEW");
    expect(out.description).toContain("ERP 백엔드"); // 워크넷은 본문을 채울 수 있음
    expect(out.dedupKey).toBe("한빛소프트웍스|backend|서울"); // (주) 제거·공백 제거
  });

  it("FULL: '관계없음'→ANY, '채용시까지'→deadline null 이어도 PARTIAL 아님 (12.8)", async () => {
    const raws = await fixtureAdapter().fetchRaw();
    const out = normalizeRawJob(raws[2]);

    expect(out.dataQuality).toBe("FULL");
    expect(out.experienceLevel).toBe("ANY"); // 워크넷 career "관계없음"
    expect(out.deadline).toBeNull(); // 상시채용 — PARTIAL 사유 아님
    expect(out.description).toBeNull(); // jobCont 없음 — PARTIAL 사유 아님(원문 URL 폴백)
  });

  it("PARTIAL: 미매핑 지역(전북)·회사명 누락·비개발 직종이 각각 PARTIAL 로 판정된다", async () => {
    const raws = await fixtureAdapter().fetchRaw();

    const region = normalizeRawJob(raws[3]); // 전북 전주시 → location null
    expect(region.dataQuality).toBe("PARTIAL");
    expect(region.location).toBeNull();
    expect(region.jobRole).toBe("devops"); // 나머지 필드는 유지

    const noCompany = normalizeRawJob(raws[4]); // company 태그 누락
    expect(noCompany.dataQuality).toBe("PARTIAL");
    expect(noCompany.companyName).toBe(COMPANY_PLACEHOLDER);

    const nonDev = normalizeRawJob(raws[5]); // 웹디자이너 → 개발직군 7종 미매핑
    expect(nonDev.dataQuality).toBe("PARTIAL");
    expect(nonDev.jobRole).toBeNull();
    expect(nonDev.location).toBe("서울");
  });
});
