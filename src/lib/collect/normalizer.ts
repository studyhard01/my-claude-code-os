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

// ---- 직무 라벨 키워드 매핑 (name → DEV_ROLE_OPTIONS.value 10종) ----
// 순서 = 우선순위. name 에 여러 키워드가 섞이면 먼저 매칭되는 값 채택.
// (fullstack 을 frontend/backend 보다 앞에 둔다: "풀스택, 웹개발" 같은 복합 name 대비.
//  robotics 를 ai-ml 보다 앞에 둔다: "측위 research scientist"는 robotics — 12.10 표.
//  ai-ml 을 data 보다 앞에 둔다: ML 계열 키워드의 data → ai-ml 재귀속 — 12.10.)
//
// [내부 테이블 — 계약 아님] 소스가 늘 때마다 여기를 보강한다. contract.ts 무관.
// [2026-07-16 보강 — 카카오 어댑터] 카카오 채용 공고 제목은 직무를 영문으로 쓴다
//   ("Data Scientist", "Machine Learning Engineer", "LLM Research Engineer").
//   기존 테이블은 한글 키워드뿐이라 실측 28건 중 6건만 매핑됐다 → 영문 표현을 추가.
//   [주의] matchKeyword 는 단순 부분문자열(includes) 매칭이라 짧은 토큰은 오탐한다.
//     예) "ai" 는 email/detail/training/maintenance 안에 들어 있어 keywords 에 넣으면 안 된다.
//     구(phrase)로 못 만드는 짧은 토큰("ai"·"qa"·"slam")은 wordKeywords 로 —
//     ASCII 단어 경계(\b) 정규식 매칭이라 email/aqua 를 오탐하지 않고,
//     한글 인접("AI엔지니어")은 한글이 \w 밖이라 경계로 인식돼 매칭된다.
type RoleKeywordEntry = {
  value: string;
  /** 부분문자열(includes) 매칭 — 3글자 이상 또는 구(phrase)만 */
  keywords: string[];
  /** 단어 경계(\b) 정규식 매칭 — 짧은 영문 토큰 전용 */
  wordKeywords?: string[];
};

const ROLE_KEYWORDS: RoleKeywordEntry[] = [
  {
    value: "fullstack",
    keywords: ["풀스택", "fullstack", "full-stack", "full stack"],
  },
  {
    value: "frontend",
    keywords: ["프론트엔드", "프론트", "frontend", "front-end", "front end"],
  },
  {
    value: "backend",
    keywords: [
      "백엔드",
      "backend",
      "back-end",
      "back end",
      "서버개발",
      "서버 개발",
      "서버 엔지니어",
      "server engineer",
      "server developer",
    ],
  },
  { value: "android", keywords: ["안드로이드", "android"] },
  { value: "ios", keywords: ["ios", "아이폰"] },
  {
    // [12.10] "측위 research scientist"(카카오모빌리티 실측)는 robotics 로 —
    //   research scientist 가 ai-ml 에도 있으므로 반드시 ai-ml 보다 앞.
    value: "robotics",
    keywords: [
      "로보틱스",
      "로봇",
      "자율주행",
      "측위",
      "robotics",
      "autonomous driving",
      "self-driving",
    ],
    wordKeywords: ["slam"],
  },
  {
    // [12.10] ML 계열 키워드는 data 에서 이동(의도된 재귀속 — 회귀 아님)
    value: "ai-ml",
    keywords: [
      "머신러닝",
      "딥러닝",
      "인공지능",
      "추론 최적화",
      "machine learning",
      "deep learning",
      "ml engineer",
      "mlops",
      "llm",
      "research scientist",
    ],
    wordKeywords: ["ai"],
  },
  {
    value: "data",
    keywords: [
      "데이터",
      "빅데이터",
      // 영문 표현(카카오 등 자체 채용 페이지 계열) — 전부 구 단위로 오탐 방지
      "data engineer",
      "data scientist",
      "data analytics",
      "data analyst",
      "data platform",
    ],
  },
  {
    value: "devops",
    keywords: ["데브옵스", "devops", "인프라", "클라우드", "sre", "site reliability"],
  },
  {
    // "품질" 단독은 넣지 않는다 — 제조·시설 품질관리(QC)까지 끌어온다(잡알리오 계열 오탐).
    value: "qa",
    keywords: ["테스트 엔지니어", "test engineer", "quality assurance", "quality engineer", "품질보증", "sdet"],
    wordKeywords: ["qa"],
  },
];

// ---- 지역 라벨 키워드 매핑 (name → LOCATION_OPTIONS.value) ----
// [2026-07-16 보강] 카카오는 근무지를 광역시도가 아니라 지명("판교")으로 준다(실측).
//   판교·분당·성남은 경기(성남시) → 경기로 매핑. 사용자 필터 선택지(LOCATION_OPTIONS)는
//   광역 단위 그대로 유지되므로 계약 변경 없음.
const LOCATION_KEYWORDS: Array<{ value: string; keywords: string[] }> = [
  { value: "서울", keywords: ["서울"] },
  { value: "경기", keywords: ["경기", "판교", "분당", "성남"] },
  { value: "인천", keywords: ["인천"] },
  { value: "부산", keywords: ["부산"] },
  { value: "대전", keywords: ["대전"] },
  { value: "원격", keywords: ["원격", "재택"] },
];

function matchKeyword(
  table: Array<{ value: string; keywords: string[]; wordKeywords?: string[] }>,
  name: string | undefined,
): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const { value, keywords, wordKeywords } of table) {
    if (keywords.some((k) => lower.includes(k))) return value;
    // 짧은 영문 토큰("ai"·"qa")은 ASCII 단어 경계로만 — email/aqua 오탐 방지
    if (wordKeywords?.some((k) => new RegExp(`\\b${k}\\b`).test(lower))) return value;
  }
  return null;
}

/** job-code.name → jobRole 라벨(10종). 매핑 실패 시 null */
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
