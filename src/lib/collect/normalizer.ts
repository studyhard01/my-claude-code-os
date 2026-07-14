// ============================================================================
// Normalizer — RawJob → JobUpsertInput (OS.md 12.8 (2)(3))
// ----------------------------------------------------------------------------
// - 라벨 매핑은 코드표가 아니라 "응답 name 필드 키워드 매핑"(12.8 결정).
//   [2026-07-14 개정] name 은 raw 직접 참조가 아니라 RawJob 정규 필드
//   jobRoleName/locationName 에서 읽는다 — 소스별 응답 구조 해석(사람인 JSON,
//   잡알리오 JSON)은 각 어댑터가 담당하고, Normalizer 는 소스 비종속으로 유지(12.8(1)).
//   code 원문은 RawJob.jobRoleCode/locationCode + raw 에 남는다(코드표 유지 부담 제거).
// - dataQuality 판정(12.8): title/companyName 누락(placeholder 대체), jobRole null,
//   location null, experience 해석 실패 → PARTIAL.
//   deadline null(상시채용)·description null(사람인 API 특성)은 PARTIAL 사유가 아님.
// - dedupKey(12.8 (3)): normCompany|jobRole|location. unique 아님(계산·저장만, 병합은 M3).
// ============================================================================

import type { ExperienceLevel, Job } from "../../types/contract";
import type { RawJob } from "./source-adapter";

/**
 * upsert 입력 형태 (12.8): 계약 Job 에서 id·collectedAt·companyId 제외 + rawData.
 * 날짜는 ISO 문자열 그대로 두고, upsert 직전 Date 변환은 수집 진입점(scripts/collect.ts) 책임.
 */
export type JobUpsertInput = Omit<Job, "id" | "collectedAt" | "companyId"> & {
  /** [A-3] 원본 payload JSON.stringify (회사 식별 힌트 보존 → M2 DART 연결 대비) */
  rawData: string | null;
};

/** title 누락 시 대체 저장값 (12.8) */
export const TITLE_PLACEHOLDER = "(제목 미확인 공고)";
/** companyName 누락 시 대체 저장값 (12.8) */
export const COMPANY_PLACEHOLDER = "(회사 미확인)";

// ---- 직무 라벨 키워드 매핑 (name → DEV_ROLE_OPTIONS.value 7종) ----
// 순서 = 우선순위. name 에 여러 키워드가 섞이면 먼저 매칭되는 값 채택.
// (fullstack 을 frontend/backend 보다 앞에 둔다: "풀스택, 웹개발" 같은 복합 name 대비)
const ROLE_KEYWORDS: Array<{ value: string; keywords: string[] }> = [
  { value: "fullstack", keywords: ["풀스택", "fullstack", "full-stack", "full stack"] },
  { value: "frontend", keywords: ["프론트엔드", "프론트", "frontend", "front-end"] },
  { value: "backend", keywords: ["백엔드", "backend", "back-end", "서버개발", "서버 개발"] },
  { value: "android", keywords: ["안드로이드", "android"] },
  { value: "ios", keywords: ["ios", "아이폰"] },
  { value: "data", keywords: ["데이터", "머신러닝", "딥러닝", "빅데이터", "인공지능"] },
  { value: "devops", keywords: ["데브옵스", "devops", "인프라", "클라우드", "sre"] },
];

// ---- 지역 라벨 키워드 매핑 (name → LOCATION_OPTIONS.value) ----
const LOCATION_KEYWORDS: Array<{ value: string; keywords: string[] }> = [
  { value: "서울", keywords: ["서울"] },
  { value: "경기", keywords: ["경기"] },
  { value: "인천", keywords: ["인천"] },
  { value: "부산", keywords: ["부산"] },
  { value: "대전", keywords: ["대전"] },
  { value: "원격", keywords: ["원격", "재택"] },
];

function matchKeyword(
  table: Array<{ value: string; keywords: string[] }>,
  name: string | undefined,
): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const { value, keywords } of table) {
    if (keywords.some((k) => lower.includes(k))) return value;
  }
  return null;
}

/** job-code.name → jobRole 라벨(7종). 매핑 실패 시 null */
export function mapJobRole(name: string | undefined): string | null {
  return matchKeyword(ROLE_KEYWORDS, name);
}

/** location.name → location 라벨. 매핑 실패 시 null */
export function mapLocation(name: string | undefined): string | null {
  return matchKeyword(LOCATION_KEYWORDS, name);
}

/**
 * experience 해석 (12.8): 사람인 experience-level code
 *   0(무관)→ANY, 1(신입)→NEW, 2(경력)→EXPERIENCED, 3(신입/경력)→ANY.
 * code 가 아닌 name 문자열도 관대하게 수용(Mock·잡알리오 등 비-code 소스):
 *   신입·경력 둘 다 포함(잡알리오 "신입+경력", 사람인 "신입/경력")→ANY,
 *   "무관"→ANY, "신입"→NEW, "경력"→EXPERIENCED.
 * 해석 실패 → ANY + resolved:false (→ PARTIAL 사유).
 */
export function mapExperience(rawValue: string | undefined): {
  level: ExperienceLevel;
  resolved: boolean;
} {
  if (rawValue == null) return { level: "ANY", resolved: false };
  const v = rawValue.trim();
  switch (v) {
    case "0":
    case "3":
      return { level: "ANY", resolved: true };
    case "1":
      return { level: "NEW", resolved: true };
    case "2":
      return { level: "EXPERIENCED", resolved: true };
  }
  // name 폴백 — 신입·경력 둘 다 포함(잡알리오 "신입+경력", 사람인 "신입/경력")을
  //   "신입"/"경력" 단독보다 먼저 판정한다. "무관"·"관계없음"도 ANY.
  if (v.includes("신입") && v.includes("경력")) return { level: "ANY", resolved: true };
  if (v.includes("무관") || v.includes("관계없음")) return { level: "ANY", resolved: true };
  if (v.includes("신입")) return { level: "NEW", resolved: true };
  if (v.includes("경력")) return { level: "EXPERIENCED", resolved: true };
  return { level: "ANY", resolved: false };
}

/** 소스 원문 날짜("2026-07-31T23:59:59+0900" 등) → ISO 문자열. 해석 불가 → null */
function toIso(v: string | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * dedupKey 계산 (12.8 (3) — 12.3 "회사+직무+지역" 구체화):
 *   normCompany|jobRole|location.
 *   normCompany = "(주)"/"㈜"/"주식회사" 제거 → 모든 공백 제거 → 소문자.
 * unique 아님 — 계산·저장만 하고 실제 병합은 M3.
 */
export function computeDedupKey(
  companyName: string,
  jobRole: string | null,
  location: string | null,
): string {
  const normCompany = companyName
    .replace(/\(주\)|㈜|주식회사/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return `${normCompany}|${jobRole ?? ""}|${location ?? ""}`;
}

/** RawJob → JobUpsertInput. 시그니처는 12.8 계약 고정. */
export function normalizeRawJob(raw: RawJob): JobUpsertInput {
  // --- PARTIAL 사유 수집 ---
  let partial = false;

  let title = raw.title?.trim() ?? "";
  if (!title) {
    title = TITLE_PLACEHOLDER;
    partial = true;
  }

  let companyName = raw.companyName?.trim() ?? "";
  if (!companyName) {
    companyName = COMPANY_PLACEHOLDER;
    partial = true;
  }

  // [12.8(1) 2026-07-14] 정규 필드만 본다 — raw 직접 참조 제거(소스 비종속)
  const jobRole = mapJobRole(raw.jobRoleName);
  if (jobRole == null) partial = true;

  const location = mapLocation(raw.locationName);
  if (location == null) partial = true;

  const exp = mapExperience(raw.experienceRaw);
  if (!exp.resolved) partial = true;

  // deadline null(상시채용)·description null(사람인 API 특성)은 PARTIAL 사유 아님(12.8)
  return {
    source: raw.source,
    sourceJobId: raw.sourceJobId,
    url: raw.url,
    title,
    companyName,
    jobRole,
    location,
    experienceLevel: exp.level,
    employmentType: raw.employmentType?.trim() || null,
    deadline: toIso(raw.deadline),
    postedAt: toIso(raw.postedAt),
    description: raw.description?.trim() || null,
    dataQuality: partial ? "PARTIAL" : "FULL",
    dedupKey: computeDedupKey(companyName, jobRole, location),
    rawData: raw.raw ? JSON.stringify(raw.raw) : null,
  };
}
