// ============================================================================
// WorknetAdapter — 워크넷(고용24) 공공 채용정보 API 어댑터 (OS.md 12.8 (5))
// ----------------------------------------------------------------------------
// - 공통 SourceAdapter 인터페이스만 준수(12.7 B-1 소스 비종속). source = "worknet".
// - 응답이 XML 이다. 외부 XML 라이브러리를 추가하지 않고(의존성 최소),
//   우리가 쓰는 필드만 뽑는 단순 태그 파서로 처리한다(필드 누락·빈 값에 방어적 —
//   실패는 undefined 로 남겨 Normalizer 가 PARTIAL 판정하게 한다).
// - fetchFn 주입 패턴·1회 실행당 호출 상한은 SaraminAdapter 와 동일 규약.
// - 소스별 구조 해석(jobsNm→jobRoleName, region→locationName 등)은 여기서 끝내고,
//   Normalizer 는 RawJob 정규 필드만 본다(12.8(1) 2026-07-14 확정).
//
// [법적/정책 유의 — 워크넷(고용24) 공공 API]
//  - 공공데이터포털 활용신청은 "자동승인" — 사람인과 달리 심사 대기 없이 즉시 가동 가능.
//  - 공공데이터는 이용약관상 재가공·서비스 활용이 허용되나, 출처 표기 의무가 있을 수 있다
//    (활용신청 시 안내 확인). M1 로컬·비상업 실습은 무방.
//  - 트래픽 제한: 개발계정 기준 일 호출 한도가 있다(포털 명시치 확인 필요, 통상 수백~수천).
//    보수적으로 사람인과 같은 실행당 상한(5콜)을 적용한다.
//
// [실키 발급 후 대조 체크리스트 — WORKNET_FIELD / 요청 파라미터]
//  워크넷 Open API 가 고용24(www.work24.go.kr) 체계로 이관되면서 엔드포인트·필드명이
//  문서 버전에 따라 다르다. 아래 상수는 구 워크넷 채용정보 목록 API(wantedApi, callTp=L)
//  스키마 기준의 "최선의 추정"이며, 실키 발급 후 실응답 1페이지를 받아 다음을 대조할 것:
//   1) API_URL 자체(work24 이관 후 URL 변경 여부)와 인증 파라미터명(authKey)
//   2) 목록 아이템 태그명(wanted)과 각 필드 태그명(WORKNET_FIELD 전체)
//   3) occupation(직종코드) 파라미터명·코드값 — 개발직군 한정이 실제로 걸리는지
//   4) closeDt 의 상시채용 표현("채용시까지" 등 비날짜 문자열) 실제 값
//   5) 목록 응답에 본문성 텍스트(jobCont 류)가 실리는지 — 없으면 상세 API(callTp=D) 후속 검토
// ============================================================================

import type { RawJob, SourceAdapter } from "./source-adapter";

/**
 * 워크넷 채용정보 목록 API — 고용24 이관 후 공식 명세로 확정 (2026-07-14 실측):
 * work24.go.kr Open API 소개 페이지 기준. returnType=xml 필수, display 상한 100,
 * startPage 상한 1000. (체크리스트 항목 1 해소 — 남은 대조: 응답 태그명·직종코드)
 */
const API_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do";

/**
 * 직종코드 — 개발직군 한정 파라미터 (실키 발급 후 대조 항목 3).
 * 워크넷 직종분류 "정보통신 연구개발직 및 공학기술직" 계열 대분류 추정값.
 * 코드가 넓거나 어긋나도 안전하다: 최종 직군 판정은 Normalizer 의
 * jobRoleName 키워드 매핑(개발직군 7종 외 → jobRole null → PARTIAL)이 담당한다.
 */
const OCCUPATION_CODE_IT = "133000";

/** 요청당 최대 건수(워크넷 display 상한 100) */
const COUNT_PER_CALL = 100;
/** 실행당 최대 호출 수 — SaraminAdapter 와 동일 규약(보수적 쿼터 보호) */
export const MAX_CALLS_PER_RUN = 5;

/**
 * 응답 XML 태그명 상수 (실키 발급 후 대조 항목 2).
 * 여기만 고치면 파싱 로직 수정 없이 실스키마에 맞출 수 있게 한 곳에 모은다.
 */
export const WORKNET_FIELD = {
  /** 목록 아이템 컨테이너 태그 */
  item: "wanted",
  /** 구인인증번호 — sourceJobId */
  id: "wantedAuthNo",
  /** 회사명 */
  company: "company",
  /** 채용제목 */
  title: "title",
  /** 직종명 → RawJob.jobRoleName */
  jobsName: "jobsNm",
  /** 직종코드 원문 → RawJob.jobRoleCode (보존용) */
  jobsCode: "jobsCd",
  /** 근무지역("서울 강남구" 형태) → RawJob.locationName */
  region: "region",
  /** 경력("신입" | "경력" | "관계없음" 등) */
  career: "career",
  /** 고용형태명("기간의 정함이 없는 근로계약" 등) */
  empType: "empTpNm",
  /** 등록일 */
  regDate: "regDt",
  /** 마감일 — 상시채용이면 "채용시까지" 류 비날짜 문자열일 수 있음(대조 항목 4) */
  closeDate: "closeDt",
  /** 워크넷 채용정보 상세 URL — RawJob.url */
  infoUrl: "wantedInfoUrl",
  /** 직무내용(본문성 텍스트). 목록 응답에 없으면 description null (대조 항목 5) */
  jobContent: "jobCont",
  /** 전체 건수(페이지 순회 종료 판정) */
  total: "total",
} as const;

export interface WorknetAdapterOptions {
  /** 공공데이터포털 발급 인증키 (WORKNET_API_KEY) */
  apiKey: string;
  /** 주입 가능한 fetch. 기본 globalThis.fetch. fixture 테스트는 가짜 fetchFn 주입 */
  fetchFn?: typeof globalThis.fetch;
}

// ---- 단순 XML 추출 헬퍼 (우리가 쓰는 필드만, 방어적) ----

/** XML 엔티티 최소 디코딩(워크넷 텍스트 필드에 &amp; 등 등장 대비) */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * XML 블록에서 <tag>...</tag> 첫 번째 텍스트를 추출.
 * CDATA 허용, trim 후 빈 값이면 undefined (→ Normalizer PARTIAL 판정 위임).
 */
export function extractTag(xml: string, tag: string): string | undefined {
  // 태그명 뒤에 곧바로 '>' 가 와야 매칭 — <wanted> 가 <wantedAuthNo> 에 걸리지 않게
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return undefined;
  let text = m[1].trim();
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) text = cdata[1].trim();
  else text = decodeXmlEntities(text);
  return text === "" ? undefined : text;
}

/** 목록 XML 에서 아이템 블록(<wanted>...</wanted>)들을 분리 */
export function extractItems(xml: string, itemTag: string = WORKNET_FIELD.item): string[] {
  const blocks: string[] = [];
  const re = new RegExp(`<${itemTag}>([\\s\\S]*?)</${itemTag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) blocks.push(m[1]);
  return blocks;
}

/**
 * 워크넷 날짜 원문 → ISO-호환 문자열.
 * "20260731" / "2026-07-31" / "26-07-31" 형태를 수용, 그 외("채용시까지" 등)는
 * undefined 로 남긴다(→ Normalizer 의 toIso 가 null 처리 = 상시채용, PARTIAL 아님).
 */
export function toDateString(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  let m = s.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/); // 20260731, 2026-07-31
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[-./](\d{2})[-./](\d{2})$/); // 26-07-31 (워크넷 축약 표기 대비)
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}

export class WorknetAdapter implements SourceAdapter {
  readonly source = "worknet";

  private readonly apiKey: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor({ apiKey, fetchFn = globalThis.fetch }: WorknetAdapterOptions) {
    if (!apiKey) {
      // 조용한 폴백 금지(12.8): 키 없이 생성 자체를 막는다 — saramin 과 동일 규약.
      throw new Error("[worknet] apiKey 가 비어 있습니다. (WORKNET_API_KEY)");
    }
    this.apiKey = apiKey;
    this.fetchFn = fetchFn;
  }

  /**
   * 목록 API 를 startPage=1 부터 순회하며 RawJob[] 수집.
   * 종료 조건: 마지막 페이지(display 미만 반환), total 도달, MAX_CALLS_PER_RUN 도달.
   */
  async fetchRaw(): Promise<RawJob[]> {
    const all: RawJob[] = [];

    for (let page = 1; page <= MAX_CALLS_PER_RUN; page++) {
      const params = new URLSearchParams({
        authKey: this.apiKey,
        callTp: "L", // 목록 조회
        returnType: "xml", // 공식 명세 필수값(소문자)
        occupation: OCCUPATION_CODE_IT, // 개발직군 한정(코드 불확실 — 최종 판정은 Normalizer)
        display: String(COUNT_PER_CALL),
        startPage: String(page),
      });
      const res = await this.fetchFn(`${API_URL}?${params.toString()}`, {
        headers: { Accept: "application/xml" },
      });
      if (!res.ok) {
        // 부분 실패 허용: 이미 받은 페이지가 있으면 그것만 반환(재실행은 idempotent).
        if (all.length > 0) {
          console.warn(
            `[worknet] HTTP ${res.status} (startPage=${page}) — 이전 페이지까지 ${all.length}건으로 계속 진행`,
          );
          break;
        }
        throw new Error(`[worknet] API 요청 실패: HTTP ${res.status} (startPage=${page})`);
      }

      const xml = await res.text();
      const items = extractItems(xml);
      for (const block of items) {
        const raw = this.toRawJob(block);
        if (raw) all.push(raw);
      }

      const total = Number(extractTag(xml, WORKNET_FIELD.total) ?? 0);
      if (items.length < COUNT_PER_CALL) break; // 마지막 페이지
      if (total > 0 && all.length >= total) break; // 전체 수집 완료
    }

    return all;
  }

  /**
   * <wanted> 블록 → RawJob (12.8(5)).
   * wantedAuthNo 가 없으면 upsert 키를 만들 수 없으므로 건너뛴다(경고 로그).
   */
  private toRawJob(block: string): RawJob | null {
    const f = (tag: string) => extractTag(block, tag);

    const sourceJobId = f(WORKNET_FIELD.id);
    if (!sourceJobId) {
      console.warn("[worknet] wantedAuthNo 없는 공고 — 건너뜀:", block.slice(0, 200));
      return null;
    }

    const url = f(WORKNET_FIELD.infoUrl);
    if (!url) {
      // url 은 RawJob 필수(폴백 CTA 의 근거). 상세 URL 미제공 시 고용24 검색 URL 로 구성.
      console.warn(`[worknet] wantedInfoUrl 누락 (${sourceJobId}) — 검색 URL 로 대체`);
    }

    return {
      source: this.source,
      sourceJobId,
      url:
        url ??
        `https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do?wantedAuthNo=${encodeURIComponent(sourceJobId)}`,
      title: f(WORKNET_FIELD.title),
      companyName: f(WORKNET_FIELD.company),
      jobRoleCode: f(WORKNET_FIELD.jobsCode),
      jobRoleName: f(WORKNET_FIELD.jobsName), // 정규 필드 승격(12.8(1)) — Normalizer 가 키워드 매핑
      locationName: f(WORKNET_FIELD.region),
      experienceRaw: f(WORKNET_FIELD.career), // "신입"|"경력"|"관계없음" → Normalizer name 폴백
      employmentType: f(WORKNET_FIELD.empType),
      deadline: toDateString(f(WORKNET_FIELD.closeDate)), // 비날짜("채용시까지")면 undefined = 상시
      postedAt: toDateString(f(WORKNET_FIELD.regDate)),
      // 본문성 텍스트가 목록 응답에 있으면 채운다(12.8(5)). 없으면 null → 프론트 원문 URL 폴백.
      description: f(WORKNET_FIELD.jobContent),
      // [A-3] 원본 보존 — XML 은 객체가 아니므로 블록 원문 문자열을 담는다(M2 회사 연결 힌트).
      raw: { xml: `<${WORKNET_FIELD.item}>${block}</${WORKNET_FIELD.item}>` },
    };
  }
}
