// ============================================================================
// KakaoCareersAdapter — 카카오 자체 채용 JSON 어댑터 (OS.md 12.8 (6))
// ----------------------------------------------------------------------------
// - 공통 SourceAdapter 인터페이스만 준수(12.7 B-1: 소스 비종속). source = "kakao".
// - 회사 공식 페이지 계열 어댑터 1호(7장 허용 원칙) — 플랫폼 크롤링 금지와 무관.
// - fetch 함수를 주입받는다(saramin/alio 와 동일): fixture 테스트가 가짜 fetchFn 으로
//   "실 파싱 코드를 그대로" 태운다. 실행 시엔 globalThis.fetch.
// - 소스별 구조 해석(jobOfferTitle/jobPartName → 정규 필드)은 여기서 끝내고,
//   Normalizer 는 RawJob 정규 필드(jobRoleName/locationName)만 본다(12.8(1) 승격).
//
// [법적/정책 유의 — 비공식 내부 API]
//  - 인증키 불필요한 공개 엔드포인트이나 "공식 API" 로 문서화된 것은 아니다.
//    예고 없이 변경·차단될 수 있으므로, 응답 구조가 기대와 다르면 조용히 빈 결과를
//    내지 않고 명확한 에러로 종료한다(12.8(6)) → 운영자가 폴백(카카오 채용 홈 URL)
//    으로 강등할지 판단한다. assertKakaoBody() 가 그 게이트다.
//  - careers.kakao.com/robots.txt 는 200 이 아니라 401 을 반환한다(2026-07-16 실측)
//    → 기계가 읽을 수 있는 허용/금지 신호가 아예 없다. RFC 9309 은 4xx 를 "제한 없음"
//      으로 보지만, 일부 크롤러 관행(구 Google 스펙)은 401/403 을 "전체 금지"로 읽는다.
//      해석이 갈리는 회색지대라는 뜻이므로, 수집 예의(7장)를 코드로 강제한다:
//        · 저빈도 — 1회 실행당 최대 MAX_CALLS_PER_RUN(5) 콜, 실제로는 2콜이면 전량 수집
//        · User-Agent 명시(USER_AGENT) — 익명 요청으로 위장하지 않는다
//        · 조회 전용(GET), 지원/로그인 등 상태 변경 경로는 건드리지 않는다
//      공개 서비스화·수익화 시점에 카카오 채용 담당에 서면 확인 권장(OS.md 7장 폴백 ③).
//
// [2026-07-16 실응답 채취로 드러난 데이터 현실 — 설계 판단 근거]
//  최상위: { jobList: [...], jobTypeCountDtoList: [...], totalJobCount, totalPage }.
//  part=TECHNOLOGY&company=ALL 로 전 계열사 개발직군 28건(2페이지, 페이지당 15건).
//
//  (a) endDate 가 표본 28건 전부 null 이다 → deadline 전건 null(상시채용).
//      OS.md 12.8(6) 의 "마감일 포함 구조화 데이터" 서술은 실측과 다르다(보고 대상).
//      12.8(2) 상 deadline null 은 PARTIAL 사유가 아니므로 dataQuality 에는 영향 없으나,
//      기본 정렬(deadline)에서 카카오 공고가 전부 뒤로 밀린다는 뜻이다.
//  (b) 경력 필드가 응답에 아예 없다. 대신 카카오 본사(P-*) 공고는 제목 괄호에
//      "(경력)"/"(신입/경력)" 표기가 있다 → extractExperienceRaw 로 제목에서 추출한다.
//      공동체(S-*) 공고는 표기가 없어 미해석 → PARTIAL(정상 — 없는 데이터를 지어내지 않는다).
//  (c) locationName 이 카카오 본사(P-*) 8건만 "판교"이고 공동체(S-*) 20건은 빈 문자열이다.
//      → 20건은 location null → PARTIAL. 공동체 소재지를 "판교일 것"이라 추정해 채우는
//      것은 날조이므로 하지 않는다. (Normalizer 에 "판교"→경기 키워드만 보강했다.)
//  (d) jobPartName 은 "테크"(coarse — alio 의 "정보통신"과 같은 성격)라 7개 개발직군에
//      단독 매핑되지 않는다 → 제목과 결합해 Normalizer 키워드 매핑 입력으로 넘긴다(alio 와 동일).
//  (e) introduction 이 HTML 본문(조직소개/업무내용/지원자격/우대사항)으로 알차다
//      → stripHtml 로 정제해 description 을 채운다. 사람인의 본문 부재 약점 보완.
//      workContentDesc/qualification 은 대부분 "-" 플레이스홀더라 그때만 보조로 쓴다.
// ============================================================================

import type { RawJob, SourceAdapter } from "./source-adapter";

const API_URL = "https://careers.kakao.com/public/api/job-list";
/** 공고 상세 페이지. realId 를 붙여 조립한다(2026-07-16 실측: S-4707·P-14469 모두 200) */
const JOB_DETAIL_BASE = "https://careers.kakao.com/jobs/";
/** 자동 수집 불가 시 최소 진입점(7장 폴백 ③) — 계약상 url 은 항상 채운다 */
export const KAKAO_CAREERS_URL = "https://careers.kakao.com/jobs";

/** 직군 필터: TECHNOLOGY = 테크(개발직군 한정 — alio 의 ncsCdLst=R600020 과 같은 자리) */
const PART_TECHNOLOGY = "TECHNOLOGY";
/** company=ALL: 카카오 본사 + 공동체(계열사) 전부 */
const COMPANY_ALL = "ALL";

/** 수집 예의(7장): 1회 실행당 최대 호출 수. 실측 totalPage=2 라 평시 2콜이면 전량 */
export const MAX_CALLS_PER_RUN = 5;

/** 수집 예의(7장): 익명 위장 금지 — 누가 왜 긁는지 밝힌다 */
export const USER_AGENT =
  "job-research-bot/0.1 (M1 study project; +https://careers.kakao.com/jobs)";

/** description 방어적 상한(계약 아님 — DB 비대화 방지). alio 와 동일 규약 */
export const DESCRIPTION_MAX_LEN = 3000;

/** companyName 이 비었을 때 폴백(12.8(6): "계열사 필드 있으면 그 값, 없으면 카카오") */
export const DEFAULT_COMPANY = "카카오";

/**
 * 실 응답 필드명 상수 (2026-07-16 실응답 채취로 확인).
 * 비공식 API 라 스키마가 바뀔 수 있다 — 여기만 고치면 파싱 로직은 그대로 둔다.
 */
export const KAKAO_FIELD = {
  /** 공고 ID("S-4707"|"P-14469") → sourceJobId · 상세 URL 조립 */
  id: "realId",
  /** 공고 제목 → title (+ 경력 표기·직무 신호 추출 입력) */
  title: "jobOfferTitle",
  /** 계열사명("카카오"|"카카오페이"|"카카오모빌리티"…) → companyName */
  company: "companyName",
  /** 계열사 코드("kpay") → raw 보존(M2 회사 연결 힌트) */
  companyCode: "companyCodeId",
  /** 직군 코드("TECHNOLOGY") → jobRoleCode(보존용) */
  jobType: "jobType",
  /** 직무 세부명("테크" — coarse) → jobRoleName 결합 입력 */
  jobPartName: "jobPartName",
  /** 근무지("판교" | "") → locationName */
  location: "locationName",
  /** 근무지 코드 → locationCode(보존용) */
  locationCode: "locationCodeId",
  /** 고용형태명("정규직"|"계약직") → employmentType */
  employeeType: "employeeTypeName",
  /** 마감일 → deadline (실측 전건 null = 상시채용) */
  endDate: "endDate",
  /** 등록일("2026-05-06T18:51:22") → postedAt */
  regDate: "regDate",
  /** HTML 본문(조직소개·업무내용·지원자격·우대사항) → description */
  introduction: "introduction",
  /** 업무내용(대부분 "-") → description 보조 */
  workContent: "workContentDesc",
  /** 지원자격(대부분 "-") → description 보조 */
  qualification: "qualification",
} as const;

export interface KakaoCareersAdapterOptions {
  /** 주입 가능한 fetch. 기본 globalThis.fetch. fixture 테스트는 가짜 fetchFn 주입 */
  fetchFn?: typeof globalThis.fetch;
}

// ---- 응답 파싱 헬퍼 (alio-adapter 와 동일 규약) ----

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict {
  return v !== null && typeof v === "object" ? (v as Dict) : {};
}

/** 문자열/숫자 → trim 된 문자열. 빈 값·기타 타입은 undefined */
function asStr(v: unknown): string | undefined {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s === "" ? undefined : s;
}

/**
 * 카카오 채용 본문 HTML → 평문.
 * 실응답의 introduction 은 <br/> 줄바꿈 + HTML 엔티티(&quot; 등) + 제로폭 공백(U+200B)이
 * 섞인 문자열이다(실측). 그대로 저장하면 프론트에 태그가 노출되므로 여기서 정제한다.
 */
export function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&") // & 복원은 반드시 마지막(이중 디코딩 방지)
    .replace(/[​-‍﻿]/g, "") // 제로폭 공백 — 실응답에 다수 섞여 있다
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? undefined : text;
}

/**
 * 본문 결합 → description (12.8(5) 와 동일 취지: 사람인 본문 부재 보완).
 * introduction 이 사실상 전문이므로 그것을 본체로 하고,
 * workContentDesc/qualification 은 "-" 플레이스홀더가 아닐 때만 덧붙인다(실측 (e)).
 */
export function buildDescription(job: Dict): string | undefined {
  const sections: string[] = [];
  const add = (label: string | null, v: string | undefined) => {
    // "-" 는 카카오가 빈 값 대신 넣는 플레이스홀더 → 본문으로 치지 않는다
    if (!v || v === "-") return;
    sections.push(label ? `[${label}]\n${v}` : v);
  };
  add(null, stripHtml(asStr(job[KAKAO_FIELD.introduction])));
  add("업무내용", stripHtml(asStr(job[KAKAO_FIELD.workContent])));
  add("지원자격", stripHtml(asStr(job[KAKAO_FIELD.qualification])));
  if (sections.length === 0) return undefined;
  const text = sections.join("\n\n");
  return text.length > DESCRIPTION_MAX_LEN ? `${text.slice(0, DESCRIPTION_MAX_LEN)}…` : text;
}

/**
 * 제목에서 경력 표기 추출 (실측 (b): 응답에 경력 필드가 없다).
 * 카카오 본사 공고는 "… Engineer(경력)" / "… (신입/경력)" 처럼 괄호로 표기한다.
 * 괄호 안에 신입/경력이 든 첫 그룹만 취해 Normalizer.mapExperience 에 넘긴다
 * (제목 전체를 넘기면 "경력자 우대" 같은 문구에 오탐하므로 괄호로 한정).
 * 표기가 없으면 undefined → Normalizer 가 미해석(PARTIAL) 처리 — 추정하지 않는다.
 */
export function extractExperienceRaw(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const m = title.match(/[(（]\s*([^)）]*(?:신입|경력)[^)）]*?)\s*[)）]/);
  return m ? m[1].trim() : undefined;
}

/**
 * realId → 공고 상세 URL (12.8(6): url 은 전 건 필수).
 * realId 가 없으면 애초에 upsert 키가 없어 toRawJob 이 건너뛰므로, 여기서는
 * 방어적으로만 채용 홈으로 폴백한다.
 */
export function buildJobUrl(realId: string | undefined): string {
  return realId ? `${JOB_DETAIL_BASE}${encodeURIComponent(realId)}` : KAKAO_CAREERS_URL;
}

/** 최상위 응답 키(2026-07-16 실측) */
const LIST_KEY = "jobList";
const TOTAL_PAGE_KEY = "totalPage";

/**
 * 응답 구조 검증 게이트 (12.8(6) — 조용한 폴백 금지).
 * 비공식 API 라 예고 없이 스키마가 바뀔 수 있다. 기대와 다르면 빈 배열을 반환해
 * "오늘은 공고가 없네" 처럼 보이게 두지 않고, 즉시 명확한 에러로 죽는다.
 */
function assertKakaoBody(body: Dict, page: number): unknown[] {
  const jobList = body[LIST_KEY];
  if (!Array.isArray(jobList)) {
    throw new Error(
      `[kakao] 응답 구조가 기대와 다릅니다: "${LIST_KEY}" 배열이 없습니다 (page=${page}, ` +
        `keys=[${Object.keys(body).join(", ")}]). 비공식 내부 API 라 스키마가 바뀌었을 수 있습니다 — ` +
        `KAKAO_FIELD/파싱을 실응답으로 재확인하거나, 폴백으로 카카오 채용 홈(${KAKAO_CAREERS_URL})을 ` +
        `안내하도록 강등하세요(OS.md 12.8(6)).`,
    );
  }
  return jobList;
}

export class KakaoCareersAdapter implements SourceAdapter {
  readonly source = "kakao";

  private readonly fetchFn: typeof globalThis.fetch;

  constructor({ fetchFn = globalThis.fetch }: KakaoCareersAdapterOptions = {}) {
    this.fetchFn = fetchFn;
  }

  /**
   * job-list 를 page=1 부터 순회하며 RawJob[] 수집.
   * 종료 조건: totalPage 도달, 빈 페이지, MAX_CALLS_PER_RUN 도달(수집 예의).
   * 인증키가 없는 공개 엔드포인트라 키 검사는 없다(saramin/alio 와 다른 점).
   */
  async fetchRaw(): Promise<RawJob[]> {
    const all: RawJob[] = [];
    /** 응답에 들어 있던 공고 객체 총수 — "받긴 했는데 하나도 못 읽음" 감지용 */
    let seenItems = 0;
    let totalPage = 1;

    for (let page = 1; page <= MAX_CALLS_PER_RUN; page++) {
      const params = new URLSearchParams({
        skillSet: "",
        part: PART_TECHNOLOGY, // 개발직군 한정
        company: COMPANY_ALL, // 본사 + 공동체(계열사)
        keyword: "",
        employeeType: "",
        page: String(page),
      });

      const res = await this.fetchFn(`${API_URL}?${params.toString()}`, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });

      if (!res.ok) {
        // 부분 실패 허용(alio 와 동일): 이미 받은 페이지가 있으면 그것만 반환.
        // 첫 페이지부터 실패면 조용히 넘어가지 않고 죽는다(12.8(6)).
        if (all.length > 0) {
          console.warn(
            `[kakao] HTTP ${res.status} (page=${page}) — 이전 페이지까지 ${all.length}건으로 계속 진행`,
          );
          break;
        }
        throw new Error(
          `[kakao] API 요청 실패: HTTP ${res.status} (page=${page}). 비공식 내부 API 라 차단·변경 ` +
            `가능성이 있습니다 — 폴백으로 카카오 채용 홈(${KAKAO_CAREERS_URL})을 안내하세요(12.8(6)).`,
        );
      }

      const body = asDict(await res.json());
      const jobList = assertKakaoBody(body, page);
      seenItems += jobList.length;

      for (const item of jobList) {
        const raw = this.toRawJob(asDict(item));
        if (raw) all.push(raw);
      }

      const reportedPages = Number(body[TOTAL_PAGE_KEY]);
      if (Number.isFinite(reportedPages) && reportedPages > 0) totalPage = reportedPages;

      if (jobList.length === 0) break; // 빈 페이지 = 끝
      if (page >= totalPage) break; // 마지막 페이지 도달
    }

    // [12.8(6) 조용한 폴백 금지] 공고 객체를 받았는데 단 한 건도 RawJob 이 되지 않았다면
    //   그건 "공고가 없는 것"이 아니라 스키마가 바뀐 것이다 → 빈 배열로 넘기지 않고 죽인다.
    if (all.length === 0 && seenItems > 0) {
      throw new Error(
        `[kakao] 공고 ${seenItems}건을 받았으나 파싱 결과가 0건입니다 — "${KAKAO_FIELD.id}" 필드가 ` +
          `사라졌거나 스키마가 바뀐 것으로 보입니다. KAKAO_FIELD 를 실응답으로 재확인하세요(12.8(6)).`,
      );
    }
    // seenItems === 0 (jobList 는 배열인데 비어 있음) 는 "지금 테크 공고가 없다"는
    //   정상 응답일 수 있으므로 에러로 죽이지 않는다. 다만 조용히 넘기지는 않는다.
    if (seenItems === 0) {
      console.warn(
        `[kakao] ${LIST_KEY} 가 비어 있습니다. 공고가 실제로 없거나 필터(part=${PART_TECHNOLOGY})가 ` +
          `무효해졌을 수 있습니다 — 카카오 채용 홈(${KAKAO_CAREERS_URL})에서 육안 확인 권장.`,
      );
    }

    return all;
  }

  /**
   * 카카오 공고 객체 → RawJob (12.8(6) 최소 요건, 2026-07-16 실응답 기준).
   * realId 가 없으면 upsert 키를 만들 수 없으므로 건너뛴다(경고 로그 — alio 와 동일).
   */
  private toRawJob(job: Dict): RawJob | null {
    const sourceJobId = asStr(job[KAKAO_FIELD.id]);
    if (!sourceJobId) {
      console.warn(
        `[kakao] ${KAKAO_FIELD.id} 없는 공고 — 건너뜀:`,
        JSON.stringify(job).slice(0, 200),
      );
      return null;
    }

    const title = asStr(job[KAKAO_FIELD.title]);
    const jobPartName = asStr(job[KAKAO_FIELD.jobPartName]);
    // [직무 신호] jobPartName("테크")은 coarse 라 단독 미매핑(실측 (d)) →
    //   제목의 구체 직무 표현("백엔드 개발자", "Data Scientist")과 결합해 넘긴다(alio 와 동일 패턴).
    const roleSignal = [title, jobPartName].filter(Boolean).join(" ") || undefined;

    return {
      source: this.source,
      sourceJobId,
      // [12.8(6)] url 은 전 건 필수 — realId 로 상세 페이지를 조립한다(실측 200 확인)
      url: buildJobUrl(sourceJobId),
      title,
      // 계열사 필드가 있으면 그 값, 없으면 "카카오"(12.8(6))
      companyName: asStr(job[KAKAO_FIELD.company]) ?? DEFAULT_COMPANY,
      jobRoleCode: asStr(job[KAKAO_FIELD.jobType]), // "TECHNOLOGY" 원문 보존(라벨 매핑엔 안 씀)
      jobRoleName: roleSignal, // [12.8(1) 승격] 소스 구조 해석은 어댑터 책임
      locationCode: asStr(job[KAKAO_FIELD.locationCode]),
      locationName: asStr(job[KAKAO_FIELD.location]), // 공동체 공고는 빈 값 → null → PARTIAL(실측 (c))
      experienceRaw: extractExperienceRaw(title), // 응답에 경력 필드가 없다 → 제목에서만(실측 (b))
      employmentType: asStr(job[KAKAO_FIELD.employeeType]),
      deadline: asStr(job[KAKAO_FIELD.endDate]), // 실측 전건 null → 상시채용(PARTIAL 사유 아님)
      postedAt: asStr(job[KAKAO_FIELD.regDate]),
      description: buildDescription(job), // introduction HTML 정제(실측 (e))
      raw: job, // [A-3] 원본 통째 보존(companyCodeId·jobType 등 M2 회사 연결 힌트)
    };
  }
}
