// ============================================================================
// AlioAdapter — 잡알리오(재정경제부_공공기관 채용정보 조회서비스) 어댑터 (OS.md 12.8 (5))
// ----------------------------------------------------------------------------
// - 공통 SourceAdapter 인터페이스만 준수(12.7 B-1: 소스 비종속). source = "alio".
// - 응답이 JSON 이다(resultType=json) → XML 파싱 불필요, JSON.parse 로 처리.
// - fetch 함수를 주입받는다: fixture 테스트(COLLECT_SOURCE=alio-fixture)가
//   가짜 fetchFn 으로 "실 파싱 코드를 그대로" 태우기 위함. 실행 시엔 globalThis.fetch.
// - 요청 규약: ncsCdLst=R600020(정보통신)로 개발직군 한정, numOfRows=100, pageNo 순회,
//   쿼터(일 1,000콜) 보호를 위해 1회 실행당 최대 5콜(SaraminAdapter 와 동일 규약).
// - 소스별 구조 해석(ncsCdNmLst/workRgnNmLst → 정규 필드)은 여기서 끝내고,
//   Normalizer 는 RawJob 정규 필드(jobRoleName/locationName)만 본다(12.8(1) 승격).
//
// [법적/정책 유의 — 잡알리오 공공 API]
//  - 공공데이터포털(ID 15125273) 개인 개발계정 "자동승인" — 심사 대기 없이 즉시 가동.
//  - 이용허락범위 제한 없음(공공데이터). M1 로컬·비상업 실습 무방. 출처 표기 권장.
//  - 트래픽: 개발계정 일 1,000콜. 보수적으로 실행당 5콜 상한(saramin 과 동일).
//
// [2026-07-14 실응답 확인 — 필드 매핑은 실측 확정]
//  최상위: { resultCode:200, resultMsg, totalCount, result: [ {...공고...} ] }.
//  아래 ALIO_FIELD 매핑은 저장된 실 응답 100건 표본으로 확인함.
//
// [실측으로 드러난 데이터 현실 — 설계 판단 근거]
//  (a) srcUrl 이 항상 정상 URL 은 아니다: ".", "없음", "해당없음", "-", "www.knudh.kr"
//      (스킴 없는 도메인) 등 정크가 표본의 ~26%. → normalizeSrcUrl 에서 스킴 보정 /
//      정크는 ALIO 채용 목록 페이지로 폴백(url 은 계약상 항상 채운다). 공고별 깊은
//      링크는 이 API 에 상세 idx 가 없어 불가(recrutPblntSn→recruview.do 는 404 실측).
//  (b) ncsCdNmLst 는 "정보통신" 같은 NCS 대분류(coarse)라, 우리 7개 개발직군
//      키워드에 단독으로는 매핑되지 않는다(실측 100건 중 0건). → 제목(recrutPbancTtl)의
//      구체 직무 표현을 함께 키워드 매핑 입력으로 결합한다. 대부분의 공공기관 IT공고는
//      제목에 세부 직무가 없어 jobRole=null → PARTIAL 로 남는 것이 정상(보조 소스 특성).
//  (c) pbancEndYmd 는 "YYYYMMDD" 문자열 → toDateString 으로 "YYYY-MM-DD" 변환 후 넘긴다
//      (Normalizer 의 new Date() 가 "20260728" 을 파싱하지 못하므로).
// ============================================================================

import type { RawJob, SourceAdapter } from "./source-adapter";

const API_URL = "https://apis.data.go.kr/1051000/recruitment/list";
/** NCS 분류 코드: R600020 = 정보통신 (M1 개발직군 한정 필터, 12.8(5)) */
const NCS_CD_IT = "R600020";
/** 요청당 최대 건수(잡알리오 numOfRows 상한 100) */
const COUNT_PER_CALL = 100;
/** 쿼터 보호: 1회 실행당 최대 호출 수 (일 1,000콜 대비, saramin 과 동일 규약) */
export const MAX_CALLS_PER_RUN = 5;

/** description 결합 시 방어적 상한(계약 아님 — DB 비대화 방지). 넘으면 잘라 "…" 부착 */
export const DESCRIPTION_MAX_LEN = 3000;

/**
 * srcUrl 정크일 때 폴백할 ALIO 채용 페이지.
 * 공고별 깊은 링크(recruview.do?idx=)는 이 API 가 상세 idx 를 주지 않아 만들 수 없다
 * (recrutPblntSn 을 idx 로 넣으면 404 — 2026-07-14 실측 확인). 그래서 공고별 링크
 * 대신 ALIO 채용 목록 페이지(200 확인)를 최소 진입점으로 준다(OS.md 7장 폴백 ③).
 */
const ALIO_LIST_URL = "https://job.alio.go.kr/recruit.do";

/**
 * 실 응답 필드명 상수 (2026-07-14 실응답 확인).
 * 여기만 고치면 파싱 로직 수정 없이 스키마 변화에 대응한다.
 */
export const ALIO_FIELD = {
  /** 공고일련번호(number) → sourceJobId */
  id: "recrutPblntSn",
  /** 기관명 → companyName */
  company: "instNm",
  /** 공고제목 → title */
  title: "recrutPbancTtl",
  /** NCS 분류명("정보통신" 등, 콤마 복수) → jobRoleName 결합 입력 */
  ncsName: "ncsCdNmLst",
  /** NCS 분류코드 → jobRoleCode(보존용) */
  ncsCode: "ncsCdLst",
  /** 근무지역명("서울" 등, 콤마 복수) → locationName */
  region: "workRgnNmLst",
  /** 채용구분명("신입+경력"|"신입"|"경력") → experienceRaw */
  recruitSe: "recrutSeNm",
  /** 고용형태명("정규직" 등) → employmentType */
  hireType: "hireTypeNmLst",
  /** 마감일(YYYYMMDD) → deadline */
  endYmd: "pbancEndYmd",
  /** 공고시작일(YYYYMMDD) → postedAt */
  bgngYmd: "pbancBgngYmd",
  /** 원문 채용 URL → url (정크 다수 — normalizeSrcUrl 로 보정) */
  srcUrl: "srcUrl",
  /** 지원자격 본문 → description 결합 */
  aplyQlfc: "aplyQlfcCn",
  /** 전형방법 본문 → description 결합 */
  screen: "scrnprcdrMthdExpln",
  /** 우대사항 본문 → description 결합 */
  pref: "prefCn",
} as const;

export interface AlioAdapterOptions {
  /** 공공데이터포털 발급 인증키 (ALIO_API_KEY). serviceKey 는 순수 hex → 별도 인코딩 불필요 */
  apiKey: string;
  /** 주입 가능한 fetch. 기본 globalThis.fetch. fixture 테스트는 가짜 fetchFn 주입 */
  fetchFn?: typeof globalThis.fetch;
}

// ---- 응답 파싱 헬퍼 (필드 누락/타입 변형에 관대 — 실패는 Normalizer 의 PARTIAL 로) ----

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
 * 잡알리오 날짜 원문("20260728" / "2026-07-28") → "YYYY-MM-DD".
 * 비정상·빈 값(월/일 범위 밖 포함)은 undefined → Normalizer 가 null(상시채용) 처리.
 */
export function toDateString(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = v.trim().match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, da] = m;
  const mn = Number(mo);
  const dn = Number(da);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return undefined;
  return `${y}-${mo}-${da}`;
}

/**
 * srcUrl → 항상 유효한 url (계약: 폴백 시에도 url 은 채운다).
 *  - http(s) 스킴 있으면 그대로.
 *  - 스킴 없는 도메인("www.knudh.kr")이면 https:// 보정.
 *  - 정크(".", "없음", "해당없음", "-", "/", ",", 빈값)면 ALIO 채용 목록 페이지로 폴백
 *    → 공고별 깊은 링크는 불가하나 최소한 출처 진입점을 준다(OS.md 7장 폴백 전략 ③).
 */
export function normalizeSrcUrl(src: string | undefined): string {
  const s = (src ?? "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`;
  return ALIO_LIST_URL;
}

/**
 * 본문성 텍스트 결합 → description (12.8(5): 사람인 본문 부재 약점을 보완).
 * 지원자격 + 우대사항 + 전형방법을 라벨과 함께 합친다. 전부 비면 undefined.
 * 너무 길면 DESCRIPTION_MAX_LEN 에서 자른다(방어적 상한 — 계약 아님).
 */
export function buildDescription(job: Dict): string | undefined {
  const sections: string[] = [];
  const add = (label: string, v: string | undefined) => {
    if (v) sections.push(`[${label}]\n${v}`);
  };
  add("지원자격", asStr(job[ALIO_FIELD.aplyQlfc]));
  add("우대사항", asStr(job[ALIO_FIELD.pref]));
  add("전형방법", asStr(job[ALIO_FIELD.screen]));
  if (sections.length === 0) return undefined;
  const text = sections.join("\n\n");
  return text.length > DESCRIPTION_MAX_LEN ? `${text.slice(0, DESCRIPTION_MAX_LEN)}…` : text;
}

export class AlioAdapter implements SourceAdapter {
  readonly source = "alio";

  private readonly apiKey: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor({ apiKey, fetchFn = globalThis.fetch }: AlioAdapterOptions) {
    if (!apiKey) {
      // 조용한 폴백 금지(12.8): 키 없이 생성 자체를 막는다 — saramin 과 동일 규약.
      throw new Error("[alio] apiKey 가 비어 있습니다. (ALIO_API_KEY)");
    }
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  /**
   * list API 를 pageNo=1 부터 순회하며 RawJob[] 수집.
   * 종료 조건: 마지막 페이지(numOfRows 미만 반환), totalCount 도달, MAX_CALLS_PER_RUN 도달.
   */
  async fetchRaw(): Promise<RawJob[]> {
    const all: RawJob[] = [];

    for (let page = 1; page <= MAX_CALLS_PER_RUN; page++) {
      const params = new URLSearchParams({
        serviceKey: this.apiKey, // 순수 hex → 인코딩 불필요(URLSearchParams 가 hex 는 그대로 둠)
        resultType: "json",
        numOfRows: String(COUNT_PER_CALL),
        pageNo: String(page),
        ncsCdLst: NCS_CD_IT, // 정보통신 필터(개발직군 한정)
      });
      const res = await this.fetchFn(`${API_URL}?${params.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        // 부분 실패 허용: 이미 받은 페이지가 있으면 그것만 반환(수집은 idempotent 재시도 가능).
        if (all.length > 0) {
          console.warn(
            `[alio] HTTP ${res.status} (pageNo=${page}) — 이전 페이지까지 ${all.length}건으로 계속 진행`,
          );
          break;
        }
        throw new Error(`[alio] API 요청 실패: HTTP ${res.status} (pageNo=${page})`);
      }

      const body = asDict(await res.json());
      const rawList = body.result;
      const list: unknown[] = Array.isArray(rawList) ? rawList : [];

      for (const item of list) {
        const raw = this.toRawJob(asDict(item));
        if (raw) all.push(raw);
      }

      const total = Number(asStr(body.totalCount) ?? 0);
      if (list.length < COUNT_PER_CALL) break; // 마지막 페이지
      if (total > 0 && all.length >= total) break; // 전체 수집 완료
    }

    return all;
  }

  /**
   * 잡알리오 공고 객체 → RawJob (12.8(5) 매핑 계약, 2026-07-14 실응답 확인).
   * recrutPblntSn 이 없으면 upsert 키를 만들 수 없으므로 건너뛴다(경고 로그).
   */
  private toRawJob(job: Dict): RawJob | null {
    const sourceJobId = asStr(job[ALIO_FIELD.id]);
    if (!sourceJobId) {
      console.warn("[alio] recrutPblntSn 없는 공고 — 건너뜀:", JSON.stringify(job).slice(0, 200));
      return null;
    }

    const title = asStr(job[ALIO_FIELD.title]);
    const ncsName = asStr(job[ALIO_FIELD.ncsName]);
    // [직무 신호] NCS 분류(coarse — 단독으로는 7개 직군 미매핑, 실측 0/100)에
    //   제목의 구체 직무 표현을 결합해 Normalizer 키워드 매핑 입력으로 넘긴다.
    //   제목에 세부 직무가 없으면 결국 미매핑 → jobRole null → PARTIAL(정상, 보조 소스).
    const roleSignal = [title, ncsName].filter(Boolean).join(" ") || undefined;

    return {
      source: this.source,
      sourceJobId,
      url: normalizeSrcUrl(asStr(job[ALIO_FIELD.srcUrl])),
      title,
      companyName: asStr(job[ALIO_FIELD.company]),
      jobRoleCode: asStr(job[ALIO_FIELD.ncsCode]), // 코드 원문 보존(라벨 매핑엔 안 씀)
      jobRoleName: roleSignal, // [12.8(1) 승격] 소스 구조 해석은 어댑터 책임
      locationName: asStr(job[ALIO_FIELD.region]),
      experienceRaw: asStr(job[ALIO_FIELD.recruitSe]), // "신입+경력"|"신입"|"경력"
      employmentType: asStr(job[ALIO_FIELD.hireType]),
      deadline: toDateString(asStr(job[ALIO_FIELD.endYmd])), // YYYYMMDD → YYYY-MM-DD
      postedAt: toDateString(asStr(job[ALIO_FIELD.bgngYmd])),
      // 본문을 채운다(12.8(5)) — 사람인과 달리 지원자격/전형방법 등이 제공됨.
      description: buildDescription(job),
      raw: job, // [A-3] 원본 통째 보존(acbgCondNmLst 학력·ongoingYn·기관코드 등 M2 힌트)
    };
  }
}
