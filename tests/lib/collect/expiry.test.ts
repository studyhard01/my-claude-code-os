// ============================================================================
// expiry — 수집 시 만료 판정 (M2 위생 조각)
// ----------------------------------------------------------------------------
// 계약 기준: 피드 API(route.ts, 12.6)와 같은 경계 —
//   만료 = deadline 이 있고 "오늘(UTC 자정)"보다 이전. 오늘 마감은 만료 아님.
//   상시채용(null)은 만료 아님.
// now 를 인자로 받으므로 달력이 넘어가도 테스트가 깨지지 않는다(시간 고정).
// ============================================================================

import { describe, expect, it } from "vitest";
import { isExpiredDeadline, startOfUtcDay } from "@/lib/collect/expiry";

const NOW = new Date("2026-07-19T10:30:00Z");

describe("isExpiredDeadline — 피드(12.6)와 같은 경계", () => {
  it("상시채용(null)은 만료가 아니다", () => {
    expect(isExpiredDeadline(null, NOW)).toBe(false);
  });

  it("어제 마감 → 만료", () => {
    expect(isExpiredDeadline("2026-07-18T23:59:59Z", NOW)).toBe(true);
    // KST 표기(사람인 형태)도 UTC 로 환산해 판정한다: 07-18 23:59 KST = 07-18 14:59 UTC
    expect(isExpiredDeadline("2026-07-18T23:59:59+0900", NOW)).toBe(true);
  });

  it("오늘 마감은 만료가 아니다 (피드의 deadline >= 오늘 과 대칭)", () => {
    expect(isExpiredDeadline("2026-07-19T00:00:00Z", NOW)).toBe(false); // 경계 정확히
    expect(isExpiredDeadline("2026-07-19T09:00:00Z", NOW)).toBe(false); // 이미 지난 시각이어도 같은 날이면 유지
    expect(isExpiredDeadline("2026-07-19T23:59:59+0900", NOW)).toBe(false);
  });

  it("미래 마감 → 만료 아님", () => {
    expect(isExpiredDeadline("2026-08-31T23:59:59Z", NOW)).toBe(false);
  });

  it("해석 불가 문자열은 스킵하지 않는다(방어적 — 지우는 쪽이 더 위험)", () => {
    expect(isExpiredDeadline("not-a-date", NOW)).toBe(false);
  });
});

describe("startOfUtcDay", () => {
  it("UTC 자정으로 내림한다 (route.ts startOfToday 와 동일 계산)", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });
});
