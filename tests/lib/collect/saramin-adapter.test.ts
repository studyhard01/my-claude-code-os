// ============================================================================
// SaraminAdapter 테스트 — fetchFn 주입으로 네트워크 없이 (OS.md 12.8 (1)) (ralph-test)
// ----------------------------------------------------------------------------
// 계약 기준: 요청 규약(job_mid_cd=2·count=110·start 순회·실행당 최대 5콜),
// 관대한 파싱(누락 필드 undefined → Normalizer 가 PARTIAL), url 폴백 필수,
// id 없으면 건너뜀, 부분 실패 허용(이미 받은 페이지는 반환).
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_CALLS_PER_RUN, SaraminAdapter } from "@/lib/collect/saramin-adapter";

type Dict = Record<string, unknown>;

/** 사람인 job 응답 항목 생성기 */
function saraminJob(id: string, overrides: Dict = {}): Dict {
  return {
    id,
    url: `https://www.saramin.co.kr/job/${id}`,
    position: {
      title: `백엔드 개발자 ${id}`,
      "job-code": { code: "84", name: "웹개발, 백엔드/서버개발" },
      location: { code: "101000", name: "서울 > 강남구" },
      "experience-level": { code: "1" },
      "job-type": { name: "정규직" },
    },
    company: { detail: { name: "토스뱅크" } },
    "expiration-date": "2026-07-31T23:59:59+0900",
    "posting-date": "2026-06-20T00:00:00+0900",
    ...overrides,
  };
}

function fakeRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** 페이지 응답 몸체 */
function pageBody(jobs: unknown, total: number): Dict {
  return { jobs: { total: String(total), job: jobs } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SaraminAdapter — 생성", () => {
  it("accessKey 없으면 생성 자체가 막힌다 (조용한 폴백 금지, 12.8)", () => {
    expect(() => new SaraminAdapter({ accessKey: "" })).toThrow(/accessKey/);
  });
});

describe("SaraminAdapter — 요청 규약과 매핑", () => {
  it("요청 쿼리: access-key·job_mid_cd=2·count=110·start=0", async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      fakeRes(pageBody([saraminJob("1001")], 1)),
    );
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    await adapter.fetchRaw();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://oapi.saramin.co.kr/job-search");
    expect(url.searchParams.get("access-key")).toBe("KEY");
    expect(url.searchParams.get("job_mid_cd")).toBe("2");
    expect(url.searchParams.get("count")).toBe("110");
    expect(url.searchParams.get("start")).toBe("0");
  });

  it("응답 → RawJob 매핑 (정규 필드 승격: jobRoleName/locationName 포함)", async () => {
    const fetchFn = vi.fn(async () => fakeRes(pageBody([saraminJob("1001")], 1)));
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    const [raw] = await adapter.fetchRaw();

    expect(raw.source).toBe("saramin");
    expect(raw.sourceJobId).toBe("1001");
    expect(raw.url).toBe("https://www.saramin.co.kr/job/1001");
    expect(raw.title).toBe("백엔드 개발자 1001");
    expect(raw.companyName).toBe("토스뱅크");
    expect(raw.jobRoleCode).toBe("84");
    expect(raw.jobRoleName).toBe("웹개발, 백엔드/서버개발");
    expect(raw.locationName).toBe("서울 > 강남구");
    expect(raw.experienceRaw).toBe("1");
    expect(raw.employmentType).toBe("정규직");
    expect(raw.deadline).toBe("2026-07-31T23:59:59+0900");
    expect(raw.description).toBeUndefined(); // 사람인은 본문 미제공
    expect(raw.raw).toMatchObject({ id: "1001" }); // [A-3] 원본 보존
  });

  it("url 누락 시 원문 view URL 을 구성해 반드시 채운다 (폴백 계약)", async () => {
    const fetchFn = vi.fn(async () =>
      fakeRes(pageBody([saraminJob("77", { url: undefined })], 1)),
    );
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    const [raw] = await adapter.fetchRaw();
    expect(raw.url).toBe("https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=77");
  });

  it("jobs.job 이 배열이 아닌 단일 객체여도(1건 응답) 수집된다", async () => {
    const fetchFn = vi.fn(async () => fakeRes(pageBody(saraminJob("solo"), 1)));
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    const out = await adapter.fetchRaw();
    expect(out).toHaveLength(1);
    expect(out[0].sourceJobId).toBe("solo");
  });

  it("id 없는 공고는 건너뛴다 (upsert 키 불가)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async () =>
      fakeRes(pageBody([saraminJob("ok"), { position: { title: "id 없음" } }], 2)),
    );
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    const out = await adapter.fetchRaw();
    expect(out.map((r) => r.sourceJobId)).toEqual(["ok"]);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

describe("SaraminAdapter — 페이지 순회와 쿼터 보호", () => {
  it("가득 찬 페이지(110건)면 start 를 올려 다음 페이지를 부른다", async () => {
    const full = Array.from({ length: 110 }, (_, i) => saraminJob(`p0-${i}`));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(pageBody(full, 115)))
      .mockResolvedValueOnce(fakeRes(pageBody([saraminJob("p1-0")], 115)));
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    const out = await adapter.fetchRaw();
    expect(out).toHaveLength(111);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchFn.mock.calls[1][0])).searchParams.get("start")).toBe("1");
  });

  it("페이지가 계속 가득 차도 실행당 최대 5콜에서 멈춘다 (쿼터 보호, 12.8)", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      const full = Array.from({ length: 110 }, (_, i) => saraminJob(`c${call}-${i}`));
      call++;
      return fakeRes(pageBody(full, 999_999));
    });
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    const out = await adapter.fetchRaw();
    expect(fetchFn).toHaveBeenCalledTimes(MAX_CALLS_PER_RUN);
    expect(out).toHaveLength(110 * MAX_CALLS_PER_RUN);
  });

  it("첫 페이지부터 HTTP 실패면 throw (조용한 실패 금지)", async () => {
    const fetchFn = vi.fn(async () => fakeRes({}, 401));
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    await expect(adapter.fetchRaw()).rejects.toThrow(/HTTP 401/);
  });

  it("뒤 페이지 실패는 부분 성공으로 — 이미 받은 건 반환 (idempotent 재시도 전제)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = Array.from({ length: 110 }, (_, i) => saraminJob(`p0-${i}`));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(pageBody(full, 500)))
      .mockResolvedValueOnce(fakeRes({}, 503));
    const adapter = new SaraminAdapter({ accessKey: "KEY", fetchFn });

    const out = await adapter.fetchRaw();
    expect(out).toHaveLength(110);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
