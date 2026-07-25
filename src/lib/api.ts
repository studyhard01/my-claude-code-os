// ============================================================================
// 데이터 접근 계층 (SERVER READS) — 단일 진입점
// ----------------------------------------------------------------------------
// 화면은 이 파일의 함수만 호출한다. Mock API → 실 API 교체 시 이 파일만 바뀌고
// 화면 코드는 그대로다(응답 계약 JobDTO/JobsListResponse 동일).
//
// [범위] 서버가 이미 구현한 읽기 API만 여기 둔다:
//   GET /api/jobs, GET /api/jobs/:id, GET|PUT /api/me/preferences
// 북마크 쓰기 API(POST/PATCH/DELETE)는 아직 미구현 → src/lib/bookmarks.tsx 의
//   클라이언트 스토어가 담당(낙관적 업데이트). 실 라우트가 나오면 그 파일에서
//   아래 fetch 로 교체하면 된다.
// ============================================================================

import type {
  JobDTO,
  JobsListResponse,
  UserPreference,
  UpdatePreferenceBody,
  JobSort,
  ApiError,
  BookmarkStatus,
  BookmarksListResponse,
  CreateBookmarkResponse,
  UpdateBookmarkResponse,
  CompaniesListResponse,
  SubscriptionsListResponse,
  CreateSubscriptionResponse,
  CompanyResearchResponse,
  ResearchNoteResponse,
} from "@/types/contract";
import {
  DEV_ROLE_OPTIONS,
  LOCATION_OPTIONS,
  EXPERIENCE_OPTIONS,
} from "@/types/contract";

/** 피드 필터 상태(화면 ↔ 쿼리 직렬화 사이의 단일 형태) */
export interface FeedFilters {
  /** role 다중값(콤마 직렬화, OR 매칭). 빈 배열 = 전체 (OS.md 12.6) */
  roles: string[];
  locations: string[];
  experiences: string[];
  keyword: string;
  sort: JobSort;
  deadlineWithin: number | null;
  includeExpired: boolean;
  /** 구독한 회사의 공고만 (OS.md 12.9). 서버는 "true" 만 참 → 직렬화도 true 일 때만 */
  subscribedOnly: boolean;
  cursor?: string | null;
}

export const DEFAULT_FILTERS: FeedFilters = {
  roles: [],
  locations: [],
  experiences: [],
  keyword: "",
  sort: "deadline",
  deadlineWithin: null,
  includeExpired: false,
  subscribedOnly: false,
  cursor: null,
};

/** 실패 응답을 계약 에러 형태(ApiError)로 파싱해 던진다. */
export class ApiRequestError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = "UNKNOWN") {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `요청에 실패했어요 (${res.status})`;
    let code = "HTTP_" + res.status;
    try {
      const body = (await res.json()) as ApiError;
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
    } catch {
      /* 본문 없음 */
    }
    throw new ApiRequestError(message, res.status, code);
  }
  return (await res.json()) as T;
}

/** FeedFilters → GET /api/jobs 쿼리스트링(12.5/12.6 규약대로 직렬화) */
export function buildJobsQuery(f: FeedFilters): string {
  const p = new URLSearchParams();
  if (f.roles.length) p.set("role", f.roles.join(",")); // 콤마 다중값(OR)
  if (f.locations.length) p.set("location", f.locations.join(","));
  if (f.experiences.length) p.set("experience", f.experiences.join(","));
  if (f.keyword.trim()) p.set("keyword", f.keyword.trim());
  p.set("sort", f.sort);
  if (f.deadlineWithin != null) p.set("deadlineWithin", String(f.deadlineWithin));
  if (f.includeExpired) p.set("includeExpired", "true");
  if (f.subscribedOnly) p.set("subscribedOnly", "true"); // "true" 만 참 (12.9)
  if (f.cursor) p.set("cursor", f.cursor);
  return p.toString();
}

// ---- URL ↔ 필터 역직렬화 (새로고침·공유 안전) ------------------------------
// URL 쿼리(= JobsQuery 직렬화, buildJobsQuery 와 동일 규약)를 FeedFilters 로 복원.
// 미지의 값/빈 값은 조용히 무시(OS.md 12.6 "미지의 필터값은 무시"). cursor 는 복원하지 않음.

const ROLE_VALUES = new Set(DEV_ROLE_OPTIONS.map((o) => o.value));
const LOCATION_VALUES = new Set(LOCATION_OPTIONS.map((o) => o.value));
const EXPERIENCE_VALUES = new Set(EXPERIENCE_OPTIONS.map((o) => o.value));

/** 필터를 나타내는 쿼리 파라미터가 하나라도 있는지(있으면 URL이 진실, 없으면 온보딩 프리셋 사용) */
export function hasFilterParams(params: URLSearchParams): boolean {
  return [
    "role",
    "location",
    "experience",
    "keyword",
    "sort",
    "deadlineWithin",
    "includeExpired",
    "subscribedOnly",
  ].some((k) => (params.get(k) ?? "").trim() !== "");
}

export function filtersFromParams(params: URLSearchParams): FeedFilters {
  const multi = (key: string, allow: Set<string>) =>
    (params.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((v) => v !== "" && allow.has(v)); // 카탈로그에 없는 값은 무시

  const dwRaw = params.get("deadlineWithin");
  const deadlineWithin =
    dwRaw != null && /^\d+$/.test(dwRaw.trim()) ? Number(dwRaw) : null;

  return {
    roles: multi("role", ROLE_VALUES),
    locations: multi("location", LOCATION_VALUES),
    experiences: multi("experience", EXPERIENCE_VALUES),
    keyword: params.get("keyword") ?? "",
    sort: params.get("sort") === "recent" ? "recent" : "deadline",
    deadlineWithin,
    includeExpired: params.get("includeExpired") === "true",
    subscribedOnly: params.get("subscribedOnly") === "true", // 서버 규약과 동일(12.9)
    cursor: null,
  };
}

export async function fetchJobs(
  f: FeedFilters,
  signal?: AbortSignal
): Promise<JobsListResponse> {
  const res = await fetch(`/api/jobs?${buildJobsQuery(f)}`, {
    cache: "no-store",
    signal,
  });
  return parse<JobsListResponse>(res);
}

export async function fetchJob(id: string, signal?: AbortSignal): Promise<JobDTO> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
  });
  return parse<JobDTO>(res);
}

export async function fetchPreferences(
  signal?: AbortSignal
): Promise<UserPreference> {
  const res = await fetch(`/api/me/preferences`, { cache: "no-store", signal });
  return parse<UserPreference>(res);
}

export async function savePreferences(
  body: UpdatePreferenceBody
): Promise<UserPreference> {
  const res = await fetch(`/api/me/preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse<UserPreference>(res);
}

// ---- 북마크 (실 DB API, OS.md 12.5) --------------------------------------
// 이 네 함수가 북마크 데이터 접근의 단일 창구다. bookmarks.tsx 스토어가
// 낙관적 업데이트 + 롤백을 얹어 호출한다.

/** GET /api/bookmarks — 저장 목록(마감 포함). status 로 필터 가능. */
export async function fetchBookmarks(
  status?: BookmarkStatus,
  signal?: AbortSignal
): Promise<BookmarksListResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`/api/bookmarks${qs}`, { cache: "no-store", signal });
  return parse<BookmarksListResponse>(res);
}

/** POST /api/bookmarks — 생성(idempotent). 응답 status 는 기본 PLANNED. */
export async function createBookmark(
  jobId: string
): Promise<CreateBookmarkResponse> {
  const res = await fetch(`/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  return parse<CreateBookmarkResponse>(res);
}

/** PATCH /api/bookmarks/:id — 상태 변경. */
export async function updateBookmark(
  bookmarkId: string,
  status: BookmarkStatus
): Promise<UpdateBookmarkResponse> {
  const res = await fetch(`/api/bookmarks/${encodeURIComponent(bookmarkId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return parse<UpdateBookmarkResponse>(res);
}

/** 204(본문 없음) 응답 공통 처리 — 성공은 조용히, 실패는 ApiError → throw */
async function parseNoContent(res: Response, fallbackMessage: string): Promise<void> {
  if (res.ok) return; // 204 는 본문 없음 → 정상
  let message = `${fallbackMessage} (${res.status})`;
  let code = "HTTP_" + res.status;
  try {
    const body = (await res.json()) as ApiError;
    if (body?.error?.message) message = body.error.message;
    if (body?.error?.code) code = body.error.code;
  } catch {
    /* 본문 없음 */
  }
  throw new ApiRequestError(message, res.status, code);
}

/** DELETE /api/bookmarks/:id — 삭제(204, 본문 없음). */
export async function deleteBookmark(bookmarkId: string): Promise<void> {
  const res = await fetch(`/api/bookmarks/${encodeURIComponent(bookmarkId)}`, {
    method: "DELETE",
  });
  await parseNoContent(res, "삭제에 실패했어요");
}

// ---- 회사·구독 (OS.md 12.9, M2a 조각 ②) ----------------------------------
// 구독 상태의 진실 출처는 GET /api/subscriptions 목록 하나다. 카드/상세는
// src/lib/subscriptions.tsx 스토어가 이 목록을 companyId 로 매칭해 그린다
// (JobDTO 에 구독 필드 없음 — 계약대로). 회사 검색은 조각 ③(온보딩)도 재사용.

/** GET /api/companies?keyword=&limit= — 회사 검색·목록(isSubscribed 포함) */
export async function fetchCompanies(
  keyword?: string,
  limit?: number,
  signal?: AbortSignal
): Promise<CompaniesListResponse> {
  const p = new URLSearchParams();
  if (keyword?.trim()) p.set("keyword", keyword.trim());
  if (limit != null) p.set("limit", String(limit));
  const qs = p.toString();
  const res = await fetch(`/api/companies${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
    signal,
  });
  return parse<CompaniesListResponse>(res);
}

/**
 * GET /api/subscriptions — 구독 목록(최신 구독순).
 * 각 항목에 회사 메타(id·name·normName·careersPageUrl)가 join 돼 온다(OS.md 12.11).
 * → 구독 목록이 곧 회사 리서치 진입 구조. 이름·채용페이지 링크를 1왕복으로 얻으므로
 *   더 이상 회사 목록을 별도로 시드 로드해 이름을 해석할 필요가 없다.
 */
export async function fetchSubscriptions(
  signal?: AbortSignal
): Promise<SubscriptionsListResponse> {
  const res = await fetch(`/api/subscriptions`, { cache: "no-store", signal });
  return parse<SubscriptionsListResponse>(res);
}

/** POST /api/subscriptions — 구독 생성(idempotent — 이미 구독 중이면 기존 반환). */
export async function createSubscription(
  companyId: string
): Promise<CreateSubscriptionResponse> {
  const res = await fetch(`/api/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  });
  return parse<CreateSubscriptionResponse>(res);
}

/** DELETE /api/subscriptions/:id — 구독 해제(204, 본문 없음). */
export async function deleteSubscription(subscriptionId: string): Promise<void> {
  const res = await fetch(
    `/api/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "DELETE" }
  );
  await parseNoContent(res, "구독 해제에 실패했어요");
}

// ---- 회사 리서치 (OS.md 12.11, M2b 조각 1) --------------------------------
// 리서치 화면의 데이터 접근 단일 창구. 회사 메타 + 노트 + 외부 데이터 슬롯 상태를
// 한 번에 받고(GET), 노트는 upsert(PUT) — 빈 content 는 삭제와 동일 효과(계약).
// 외부 데이터(공시·인재상)는 조각 2·3 에서 채운다(지금 researchStatus 는 항상 PENDING).

/** GET /api/companies/:id/research — 리서치 aggregate. 없는 회사 → 404 COMPANY_NOT_FOUND. */
export async function fetchCompanyResearch(
  companyId: string,
  signal?: AbortSignal
): Promise<CompanyResearchResponse> {
  const res = await fetch(
    `/api/companies/${encodeURIComponent(companyId)}/research`,
    { cache: "no-store", signal }
  );
  return parse<CompanyResearchResponse>(res);
}

/**
 * PUT /api/companies/:id/research/note — 노트 upsert(idempotent).
 * 빈/공백 content 를 보내면 노트 삭제 → 응답 { note: null }.
 */
export async function upsertResearchNote(
  companyId: string,
  content: string
): Promise<ResearchNoteResponse> {
  const res = await fetch(
    `/api/companies/${encodeURIComponent(companyId)}/research/note`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  return parse<ResearchNoteResponse>(res);
}

/** DELETE /api/companies/:id/research/note — 노트 삭제(204, 멱등). */
export async function deleteResearchNote(companyId: string): Promise<void> {
  const res = await fetch(
    `/api/companies/${encodeURIComponent(companyId)}/research/note`,
    { method: "DELETE" }
  );
  await parseNoContent(res, "노트 삭제에 실패했어요");
}
