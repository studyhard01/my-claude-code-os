// ============================================================================
// api.ts 테스트 — 데이터 접근 계층 (OS.md 12.5/12.6) (ralph-test)
// ----------------------------------------------------------------------------
// 계약 기준: 쿼리 직렬화(콤마 다중값 OR, 기본값 생략)·역직렬화(미지의 값 무시,
// URL 이 진실), 에러는 ApiError → ApiRequestError 로 변환, DELETE 204 본문 없음.
// 모듈이 전역 fetch 를 직접 부르므로 vi.stubGlobal 로 목킹한다.
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  DEFAULT_FILTERS,
  buildJobsQuery,
  deleteBookmark,
  fetchJob,
  fetchJobs,
  filtersFromParams,
  hasFilterParams,
  type FeedFilters,
} from "@/lib/api";

function fakeRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error("본문 없음");
      return body;
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildJobsQuery — FeedFilters → 쿼리스트링 (12.6)", () => {
  it("기본 필터는 sort 만 직렬화한다 (빈 배열/false/null 은 생략)", () => {
    expect(buildJobsQuery(DEFAULT_FILTERS)).toBe("sort=deadline");
  });

  it("다중값은 콤마(OR), 나머지 필드도 규약대로", () => {
    const f: FeedFilters = {
      roles: ["backend", "frontend"],
      locations: ["서울"],
      experiences: ["NEW"],
      keyword: "  결제 ",
      sort: "recent",
      deadlineWithin: 7,
      includeExpired: true,
      subscribedOnly: true,
      cursor: "abc",
    };
    const p = new URLSearchParams(buildJobsQuery(f));
    expect(p.get("role")).toBe("backend,frontend");
    expect(p.get("location")).toBe("서울");
    expect(p.get("experience")).toBe("NEW");
    expect(p.get("keyword")).toBe("결제"); // trim
    expect(p.get("sort")).toBe("recent");
    expect(p.get("deadlineWithin")).toBe("7");
    expect(p.get("includeExpired")).toBe("true");
    expect(p.get("subscribedOnly")).toBe("true"); // 12.9: "true" 만 참 → true 일 때만 직렬화
    expect(p.get("cursor")).toBe("abc");
  });

  it("공백뿐인 keyword 는 생략된다", () => {
    const q = buildJobsQuery({ ...DEFAULT_FILTERS, keyword: "   " });
    expect(new URLSearchParams(q).has("keyword")).toBe(false);
  });
});

describe("filtersFromParams — URL → FeedFilters 복원 (12.6: 미지의 값 무시)", () => {
  it("직렬화 → 역직렬화 왕복이 보존된다 (cursor 제외)", () => {
    const f: FeedFilters = {
      roles: ["backend"],
      locations: ["서울", "원격"],
      experiences: ["NEW", "ANY"],
      keyword: "결제",
      sort: "recent",
      deadlineWithin: 14,
      includeExpired: true,
      subscribedOnly: true,
      cursor: "cur-1",
    };
    const back = filtersFromParams(new URLSearchParams(buildJobsQuery(f)));
    expect(back).toEqual({ ...f, cursor: null });
  });

  it("카탈로그에 없는 값·빈 조각은 조용히 버린다", () => {
    const p = new URLSearchParams("role=backend,ninja,,frontend&location=화성");
    const f = filtersFromParams(p);
    expect(f.roles).toEqual(["backend", "frontend"]);
    expect(f.locations).toEqual([]);
  });

  it("sort 는 recent 외엔 전부 deadline 으로", () => {
    expect(filtersFromParams(new URLSearchParams("sort=recent")).sort).toBe("recent");
    expect(filtersFromParams(new URLSearchParams("sort=hack")).sort).toBe("deadline");
    expect(filtersFromParams(new URLSearchParams("")).sort).toBe("deadline");
  });

  it("deadlineWithin 은 숫자만 (음수·문자는 null)", () => {
    expect(filtersFromParams(new URLSearchParams("deadlineWithin=7")).deadlineWithin).toBe(7);
    expect(filtersFromParams(new URLSearchParams("deadlineWithin=-3")).deadlineWithin).toBeNull();
    expect(filtersFromParams(new URLSearchParams("deadlineWithin=abc")).deadlineWithin).toBeNull();
  });

  it("includeExpired 는 정확히 'true' 일 때만", () => {
    expect(filtersFromParams(new URLSearchParams("includeExpired=true")).includeExpired).toBe(true);
    expect(filtersFromParams(new URLSearchParams("includeExpired=1")).includeExpired).toBe(false);
  });

  it("subscribedOnly 는 정확히 'true' 일 때만 (12.9 서버 규약과 동일)", () => {
    expect(filtersFromParams(new URLSearchParams("subscribedOnly=true")).subscribedOnly).toBe(true);
    expect(filtersFromParams(new URLSearchParams("subscribedOnly=1")).subscribedOnly).toBe(false);
    expect(filtersFromParams(new URLSearchParams("")).subscribedOnly).toBe(false);
  });
});

describe("hasFilterParams — URL 이 필터의 진실인지 판정", () => {
  it("필터 파라미터가 하나라도 있으면 true", () => {
    expect(hasFilterParams(new URLSearchParams("sort=recent"))).toBe(true);
    expect(hasFilterParams(new URLSearchParams("role=backend"))).toBe(true);
    expect(hasFilterParams(new URLSearchParams("subscribedOnly=true"))).toBe(true);
  });

  it("없거나·빈 값이거나·무관한 파라미터뿐이면 false", () => {
    expect(hasFilterParams(new URLSearchParams(""))).toBe(false);
    expect(hasFilterParams(new URLSearchParams("role="))).toBe(false);
    expect(hasFilterParams(new URLSearchParams("utm_source=x"))).toBe(false);
  });
});

describe("fetch 래퍼 — 요청 형태와 에러 변환", () => {
  it("fetchJobs 는 /api/jobs?<직렬화 쿼리> 를 no-store 로 부른다", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      fakeRes({ items: [], nextCursor: null, totalCount: 0, partialHiddenCount: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchJobs({ ...DEFAULT_FILTERS, roles: ["backend"] });

    expect(out.totalCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/jobs?role=backend&sort=deadline");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("실패 응답의 ApiError 본문을 ApiRequestError 로 변환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeRes({ error: { code: "NOT_FOUND", message: "공고가 없어요" } }, 404),
      ),
    );

    const err = await fetchJob("ghost").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(404);
    expect((err as ApiRequestError).code).toBe("NOT_FOUND");
    expect((err as ApiRequestError).message).toBe("공고가 없어요");
  });

  it("본문 없는 실패는 HTTP_<status> 폴백 코드로", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeRes(undefined, 500)));

    const err = await fetchJob("x").catch((e: unknown) => e);
    expect((err as ApiRequestError).code).toBe("HTTP_500");
  });

  it("deleteBookmark: 204(본문 없음)는 정상, 실패는 throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeRes(undefined, 204)));
    await expect(deleteBookmark("bm_1")).resolves.toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeRes({ error: { code: "NOT_FOUND", message: "없음" } }, 404)),
    );
    await expect(deleteBookmark("bm_1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
