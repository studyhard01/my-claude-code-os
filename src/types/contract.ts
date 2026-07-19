// ============================================================================
// 공유 계약 (SINGLE SOURCE OF TRUTH) — OS.md 12.3 / 12.4 / 12.5 / 12.6
// ----------------------------------------------------------------------------
// 프론트엔드는 이 파일 하나만 import 한다:  import type { JobDTO } from "@/types/contract"
// 백엔드 API 응답도 이 타입들을 그대로 반환한다. (타입 = HTTP contract)
//
// [주의] 여기 날짜 필드는 전부 ISO 8601 "문자열"이다.
//   DB(Prisma)는 deadline/postedAt/collectedAt 을 DateTime 으로 저장하지만,
//   JSON 직렬화 시 ISO 문자열이 되므로 프론트가 받는 wire 형태는 string 이다.
//   → 이 파일은 "프론트가 받는 형태" 기준. Prisma 모델 타입과는 별개.
// ============================================================================

// ---- Enum 성격의 union 타입 (SQLite enum 미지원 → DB 는 String, 값 범위는 여기서 강제) ----

/** 경력 구분: 신입 / 경력 / 무관 */
export type ExperienceLevel = "NEW" | "EXPERIENCED" | "ANY";

/** 자동수집 완성도. PARTIAL = 핵심 필드 누락(원문 직접 확인 유도) */
export type DataQuality = "FULL" | "PARTIAL";

/** 북마크 상태: 지원예정 / 지원함 / 마감 */
export type BookmarkStatus = "PLANNED" | "APPLIED" | "CLOSED";

// ---- 핵심 엔티티 ----

/** 정규화 공통 공고 (OS.md 12.3). DB Job 행의 wire 표현. */
export interface Job {
  id: string;
  source: string;
  sourceJobId: string;
  /** 원문 출처 URL. 폴백(PARTIAL) 시에도 항상 채워짐 → 프론트 폴백 CTA 의 근거 */
  url: string;
  title: string;
  companyName: string;
  /** 회사 연결(12.9 조각 ①). placeholder "(회사 미확인)" 공고만 null */
  companyId: string | null;
  /** 직무 분류(코드→라벨). M1 개발직군 한정 */
  jobRole: string | null;
  location: string | null;
  experienceLevel: ExperienceLevel;
  employmentType: string | null;
  /** ISO date. null = 상시채용/미정 → 프론트 "상시" 뱃지, 정렬 시 항상 맨 뒤 */
  deadline: string | null;
  /** ISO date */
  postedAt: string | null;
  /** 직무 요건. 사람인 API 는 본문 미제공 → 보통 null. null 이면 프론트는 원문 URL 폴백을 1급 요소로 */
  description: string | null;
  dataQuality: DataQuality;
  /** 회사+직무+지역 (마감일 제외). unique 아님. 실제 중복 병합은 M3 */
  dedupKey: string;
  /** 수집 시각 ISO */
  collectedAt: string;
}

/** 관심 공고 저장 (OS.md 12.3) */
export interface Bookmark {
  id: string;
  jobId: string;
  status: BookmarkStatus;
  /** 가벼운 메모(정식 리서치 노트는 M2) */
  memo: string | null;
  createdAt: string;
}

/**
 * 프론트가 받는 공고 형태 (OS.md 12.4).
 * = Job + 모아보기/북마크 파생 필드.
 */
export type JobDTO = Job & {
  /** M1 은 [source] 1개. M3 중복 병합 시 복수(계약 변경 불필요) */
  sources: string[];
  /** 묶인 중복 수. M1 = 1. "여러 사이트를 한 곳에서" 체감용 */
  duplicateCount: number;
  /** null = 미저장 */
  bookmark: { bookmarkId: string; status: BookmarkStatus } | null;
};

/**
 * 회사 엔티티 (OS.md 12.9 — 2026-07-19 확정, M2a 조각 ①).
 * 동일성 키 = normName(12.8(3) normCompany 규칙 재사용 — normalizeCompanyName 단일 출처).
 */
export interface Company {
  id: string;
  /** 대표 표기명 — 최초 관측된 companyName 원문(재수집 시 덮어쓰지 않음) */
  name: string;
  /** 회사 동일성 키. UNIQUE */
  normName: string;
  /** 공식 채용 페이지 URL — M3 ATS 수집 대상. 조각 ①에선 항상 null */
  careersPageUrl: string | null;
  createdAt: string;
}

/** 사용자↔회사 구독 (OS.md 12.9). 회사당 1개. 구현은 M2a 조각 ② */
export interface CompanySubscription {
  id: string;
  companyId: string;
  createdAt: string;
}

/** 사용자 조건 (OS.md 12.3). M1 단일 로컬 사용자 1행 */
export interface UserPreference {
  roles: string[];
  locations: string[];
  experience: ExperienceLevel;
  keywords: string[];
}

// ---- API 응답/요청 형태 (OS.md 12.5) ----

/** GET /api/jobs 응답 */
export interface JobsListResponse {
  items: JobDTO[];
  /** 커서 페이지네이션. 다음 페이지 없으면 null */
  nextCursor: string | null;
  totalCount: number;
  /**
   * 필터로 가려진 PARTIAL 공고 수 (OS.md 12.6).
   * 프론트는 "조건 확인 어려운 공고 N건"을 접이식으로 노출 → 모아보기 가치 보호.
   */
  partialHiddenCount: number;
}

/** GET /api/bookmarks 응답 (includeExpired 무시 — 마감도 표시) */
export interface BookmarksListResponse {
  items: JobDTO[];
}

/** PUT /api/me/preferences 요청 바디 */
export type UpdatePreferenceBody = UserPreference;

/** POST /api/bookmarks 요청 바디 */
export interface CreateBookmarkBody {
  jobId: string;
}

/** POST /api/bookmarks 응답 */
export interface CreateBookmarkResponse {
  bookmarkId: string;
  status: BookmarkStatus;
}

/** PATCH /api/bookmarks/:id 요청 바디 */
export interface UpdateBookmarkBody {
  status: BookmarkStatus;
}

/** PATCH /api/bookmarks/:id 응답 */
export interface UpdateBookmarkResponse {
  bookmarkId: string;
  status: BookmarkStatus;
}

/** 표준 에러 형태 (OS.md 12.5). HTTP status 와 함께 전달. 빈 결과는 에러 아님(items: []) */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// ---- GET /api/jobs 쿼리 파라미터 (프론트 필터 UI 참조용) ----

export type JobSort = "deadline" | "recent";

/**
 * GET /api/jobs 쿼리 (12.5/12.6).
 * 프론트는 이걸 URLSearchParams 로 직렬화. 다중값(location/experience)은 콤마로.
 */
export interface JobsQuery {
  /** 다중 가능, 콤마 구분: "backend,fullstack" (합집합). location/experience 와 동일 규약 */
  role?: string;
  /** 다중 가능, 콤마 구분: "서울,경기" */
  location?: string;
  /** 다중 가능, 콤마 구분: "NEW,ANY" */
  experience?: string;
  keyword?: string;
  /** 기본 정렬은 deadline(마감임박순) */
  sort?: JobSort;
  /** N일 이내 마감 */
  deadlineWithin?: number;
  /** 마감 지난 공고 포함 여부. 기본 false */
  includeExpired?: boolean;
  /** 구독한 회사의 공고만 (12.9 확정). 서버는 "true" 만 참. 구현은 M2a 조각 ② */
  subscribedOnly?: boolean;
  cursor?: string;
}

// ---- 개발직군 직무 카탈로그 (온보딩/필터 선택지) ----
//
// 11장 결정: 개발직군 한정(비개발 직군은 M3+, 해당 공고는 role=unassigned 구획으로 도달).
// [2026-07-17 M2 확장 — 12.10] 7→10종: ai-ml·robotics·qa 추가, data 라벨 정정
//   (카카오 라이브 미매핑 14/28 실측 — "카탈로그에 자리 없음"이 원인).
// 값(value)은 Job.jobRole 에 그대로 저장/필터되는 라벨.
// [주의] 사람인 job_cd ↔ 라벨 실매핑은 SaraminAdapter 실연동(승인 후) 시 확정한다.
//   지금 code 는 placeholder 이며, 프론트는 value/label 만 사용하면 된다.

export interface DevRoleOption {
  /** 사람인 job_cd placeholder (실매핑은 어댑터 연동 시 확정) */
  code: string;
  /** Job.jobRole 저장/필터 값 */
  value: string;
  /** 화면 표시 라벨 */
  label: string;
}

export const DEV_ROLE_OPTIONS: DevRoleOption[] = [
  { code: "TBD-be", value: "backend", label: "백엔드 개발" },
  { code: "TBD-fe", value: "frontend", label: "프론트엔드 개발" },
  { code: "TBD-fs", value: "fullstack", label: "풀스택 개발" },
  { code: "TBD-and", value: "android", label: "안드로이드 개발" },
  { code: "TBD-ios", value: "ios", label: "iOS 개발" },
  { code: "TBD-data", value: "data", label: "데이터 엔지니어" },
  { code: "TBD-aiml", value: "ai-ml", label: "AI/ML 엔지니어·리서치" },
  { code: "TBD-robotics", value: "robotics", label: "로보틱스/자율주행" },
  { code: "TBD-qa", value: "qa", label: "QA/테스트 엔지니어" },
  { code: "TBD-devops", value: "devops", label: "DevOps/인프라" },
];

/** 자주 쓰는 지역 선택지(다중 선택). value = Job.location 저장/필터 값 */
export const LOCATION_OPTIONS: { value: string; label: string }[] = [
  { value: "서울", label: "서울" },
  { value: "경기", label: "경기" },
  { value: "인천", label: "인천" },
  { value: "부산", label: "부산" },
  { value: "대전", label: "대전" },
  { value: "원격", label: "원격/재택" },
];

export const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "NEW", label: "신입" },
  { value: "EXPERIENCED", label: "경력" },
  { value: "ANY", label: "경력무관" },
];

/** M1 단일 로컬 사용자 고정 ID (인증 도입은 M2~M3) */
export const LOCAL_USER_ID = "local";
