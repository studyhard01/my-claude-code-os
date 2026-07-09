// ============================================================================
// Normalizer 테스트 (OS.md 12.8) — ralph-test 1바퀴
// ----------------------------------------------------------------------------
// 계약 기준: 라벨 매핑(name 키워드), experience 해석, dedupKey 계산,
// FULL/PARTIAL 판정. deadline/description null 은 PARTIAL 사유가 아님.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  COMPANY_PLACEHOLDER,
  TITLE_PLACEHOLDER,
  computeDedupKey,
  mapExperience,
  mapJobRole,
  mapLocation,
  normalizeRawJob,
} from "@/lib/collect/normalizer";
import type { RawJob } from "@/lib/collect/source-adapter";

describe("mapJobRole — job-code.name 키워드 → 직무 라벨", () => {
  it("한국어·영어 키워드를 매핑한다 (대소문자 무시)", () => {
    expect(mapJobRole("웹개발, 백엔드/서버개발")).toBe("backend");
    expect(mapJobRole("Frontend Engineer")).toBe("frontend");
    expect(mapJobRole("데이터 엔지니어")).toBe("data");
  });

  it("복합 name 은 우선순위(풀스택 > 프론트/백엔드)를 따른다", () => {
    expect(mapJobRole("풀스택, 웹개발")).toBe("fullstack");
    expect(mapJobRole("프론트엔드, 풀스택")).toBe("fullstack");
  });

  it("매핑 실패·입력 없음 → null", () => {
    expect(mapJobRole("영업관리")).toBeNull();
    expect(mapJobRole(undefined)).toBeNull();
  });
});

describe("mapLocation — location.name 키워드 → 지역 라벨", () => {
  it("사람인 형태('서울 > 강남구')와 재택 표현을 매핑한다", () => {
    expect(mapLocation("서울 > 강남구")).toBe("서울");
    expect(mapLocation("재택근무")).toBe("원격");
  });

  it("매핑 실패·입력 없음 → null", () => {
    expect(mapLocation("제주")).toBeNull();
    expect(mapLocation(undefined)).toBeNull();
  });
});

describe("mapExperience — code 우선, name 폴백 (12.8)", () => {
  it("사람인 code: 0/3→ANY, 1→NEW, 2→EXPERIENCED (모두 resolved)", () => {
    expect(mapExperience("0")).toEqual({ level: "ANY", resolved: true });
    expect(mapExperience("3")).toEqual({ level: "ANY", resolved: true });
    expect(mapExperience("1")).toEqual({ level: "NEW", resolved: true });
    expect(mapExperience("2")).toEqual({ level: "EXPERIENCED", resolved: true });
  });

  it("name 폴백: '신입/경력'·'무관'을 '신입'/'경력'보다 먼저 판정한다", () => {
    expect(mapExperience("신입/경력")).toEqual({ level: "ANY", resolved: true });
    expect(mapExperience("경력무관")).toEqual({ level: "ANY", resolved: true });
    expect(mapExperience("신입")).toEqual({ level: "NEW", resolved: true });
    expect(mapExperience("경력 3년↑")).toEqual({ level: "EXPERIENCED", resolved: true });
  });

  it("해석 실패·입력 없음 → ANY + resolved:false (PARTIAL 사유)", () => {
    expect(mapExperience("junior")).toEqual({ level: "ANY", resolved: false });
    expect(mapExperience(undefined)).toEqual({ level: "ANY", resolved: false });
  });
});

describe("computeDedupKey — normCompany|jobRole|location (12.8 (3))", () => {
  it("법인 표기 제거·공백 제거·소문자화", () => {
    expect(computeDedupKey("(주)토스뱅크", "backend", "서울")).toBe("토스뱅크|backend|서울");
    expect(computeDedupKey("주식회사 카카오", "frontend", "경기")).toBe("카카오|frontend|경기");
    expect(computeDedupKey("㈜ ABC Lab", "data", "원격")).toBe("abclab|data|원격");
  });

  it("jobRole/location null 은 빈 칸으로 들어간다", () => {
    expect(computeDedupKey("토스뱅크", null, null)).toBe("토스뱅크||");
  });
});

describe("normalizeRawJob — RawJob → JobUpsertInput", () => {
  /** 힌트가 전부 채워진 RawJob (FULL 기대) */
  function fullRaw(): RawJob {
    return {
      source: "saramin",
      sourceJobId: "SR-1",
      url: "https://example.com/1",
      title: " 백엔드 개발자 ",
      companyName: "(주)토스뱅크",
      experienceRaw: "1",
      employmentType: "정규직",
      deadline: "2026-07-31T23:59:59+0900",
      postedAt: "2026-06-20",
      raw: {
        position: {
          "job-code": { code: "2", name: "웹개발, 백엔드/서버개발" },
          location: { code: "101000", name: "서울 > 강남구" },
        },
      },
    };
  }

  it("모든 힌트가 있으면 FULL — 라벨·경력·dedupKey·ISO 날짜까지 계약대로", () => {
    const out = normalizeRawJob(fullRaw());
    expect(out.dataQuality).toBe("FULL");
    expect(out.title).toBe("백엔드 개발자"); // trim
    expect(out.companyName).toBe("(주)토스뱅크"); // 원문 유지(정규화는 dedupKey 에서만)
    expect(out.jobRole).toBe("backend");
    expect(out.location).toBe("서울");
    expect(out.experienceLevel).toBe("NEW");
    expect(out.deadline).toBe("2026-07-31T14:59:59.000Z"); // +0900 → UTC ISO
    expect(out.postedAt).toBe("2026-06-20T00:00:00.000Z");
    expect(out.dedupKey).toBe("토스뱅크|backend|서울");
    expect(out.rawData).toBe(JSON.stringify(fullRaw().raw));
  });

  it("deadline(상시채용)·description 없음은 PARTIAL 사유가 아니다 (12.8)", () => {
    const raw = fullRaw();
    delete raw.deadline;
    delete raw.description;
    const out = normalizeRawJob(raw);
    expect(out.dataQuality).toBe("FULL");
    expect(out.deadline).toBeNull();
    expect(out.description).toBeNull();
  });

  it("최소 RawJob(URL 폴백)은 placeholder 대체 + PARTIAL", () => {
    const out = normalizeRawJob({
      source: "saramin",
      sourceJobId: "SR-2",
      url: "https://example.com/2",
      raw: {},
    });
    expect(out.dataQuality).toBe("PARTIAL");
    expect(out.title).toBe(TITLE_PLACEHOLDER);
    expect(out.companyName).toBe(COMPANY_PLACEHOLDER);
    expect(out.jobRole).toBeNull();
    expect(out.location).toBeNull();
    expect(out.experienceLevel).toBe("ANY");
    expect(out.employmentType).toBeNull();
    expect(out.rawData).toBe("{}"); // raw 는 빈 객체여도 통째로 보존(A-3)
  });

  it("라벨 매핑 하나라도 실패하면 PARTIAL (나머지 필드는 유지)", () => {
    const raw = fullRaw();
    (raw.raw as { position: { location: { name: string } } }).position.location.name =
      "제주 > 전체";
    const out = normalizeRawJob(raw);
    expect(out.dataQuality).toBe("PARTIAL");
    expect(out.location).toBeNull();
    expect(out.jobRole).toBe("backend");
  });

  it("해석 불가 날짜는 null 로 저장한다", () => {
    const raw = fullRaw();
    raw.deadline = "상시채용";
    const out = normalizeRawJob(raw);
    expect(out.deadline).toBeNull();
  });
});
