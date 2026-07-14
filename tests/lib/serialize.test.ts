// ============================================================================
// serialize.ts 테스트 — Prisma Job 행 → JobDTO (OS.md 12.3/12.4) (ralph-test)
// ----------------------------------------------------------------------------
// 계약 기준: 날짜는 ISO 문자열(wire 형태), sources=[source]·duplicateCount=1
// (M1 자리 확보), bookmark 는 join 계산(없으면 null), rawData 는 DTO 미노출.
// DB 없이 Prisma 행 모양의 리터럴로 순수 함수만 검증한다.
// ============================================================================

import { describe, expect, it } from "vitest";
import { JOB_INCLUDE, toJobDTO, type JobWithBookmarks } from "@/lib/serialize";

function jobRow(overrides: Partial<JobWithBookmarks> = {}): JobWithBookmarks {
  return {
    id: "job_1",
    source: "saramin",
    sourceJobId: "SR-1",
    url: "https://example.com/1",
    title: "백엔드 개발자",
    companyName: "토스뱅크",
    companyId: null,
    jobRole: "backend",
    location: "서울",
    experienceLevel: "NEW",
    employmentType: "정규직",
    deadline: new Date("2026-07-31T14:59:59.000Z"),
    postedAt: new Date("2026-06-20T00:00:00.000Z"),
    description: null,
    dataQuality: "FULL",
    dedupKey: "토스뱅크|backend|서울",
    rawData: "{}",
    collectedAt: new Date("2026-07-01T00:00:00.000Z"),
    bookmarks: [],
    ...overrides,
  };
}

describe("toJobDTO — 필드 매핑과 wire 형태", () => {
  it("날짜(DateTime)는 ISO 문자열로 변환된다", () => {
    const dto = toJobDTO(jobRow());
    expect(dto.deadline).toBe("2026-07-31T14:59:59.000Z");
    expect(dto.postedAt).toBe("2026-06-20T00:00:00.000Z");
    expect(dto.collectedAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("deadline/postedAt null(상시채용 등)은 null 그대로", () => {
    const dto = toJobDTO(jobRow({ deadline: null, postedAt: null }));
    expect(dto.deadline).toBeNull();
    expect(dto.postedAt).toBeNull();
  });

  it("DTO 파생 필드: sources=[source], duplicateCount=1 (M1 자리 확보)", () => {
    const dto = toJobDTO(jobRow({ source: "alio" }));
    expect(dto.sources).toEqual(["alio"]);
    expect(dto.duplicateCount).toBe(1);
  });

  it("원본 스칼라 필드는 그대로 통과한다 (null 포함)", () => {
    const dto = toJobDTO(jobRow({ jobRole: null, location: null, employmentType: null }));
    expect(dto.id).toBe("job_1");
    expect(dto.companyId).toBeNull();
    expect(dto.jobRole).toBeNull();
    expect(dto.location).toBeNull();
    expect(dto.employmentType).toBeNull();
    expect(dto.dataQuality).toBe("FULL");
    expect(dto.dedupKey).toBe("토스뱅크|backend|서울");
  });

  it("rawData 는 wire 계약(JobDTO)에 노출되지 않는다", () => {
    const dto = toJobDTO(jobRow({ rawData: '{"secret":"hint"}' }));
    expect("rawData" in dto).toBe(false);
  });
});

describe("toJobDTO — bookmark join 계산 (12.3)", () => {
  it("북마크 없으면 null", () => {
    expect(toJobDTO(jobRow()).bookmark).toBeNull();
  });

  it("북마크 있으면 {bookmarkId, status} 로 축약된다 (memo 등은 미노출)", () => {
    const dto = toJobDTO(
      jobRow({
        bookmarks: [
          {
            id: "bm_1",
            jobId: "job_1",
            status: "APPLIED",
            memo: "서류 제출함",
            createdAt: new Date("2026-07-02T00:00:00.000Z"),
          },
        ],
      }),
    );
    expect(dto.bookmark).toEqual({ bookmarkId: "bm_1", status: "APPLIED" });
  });
});

describe("JOB_INCLUDE — GET 재사용 include 옵션", () => {
  it("bookmarks join 을 포함한다", () => {
    expect(JOB_INCLUDE).toEqual({ bookmarks: true });
  });
});
