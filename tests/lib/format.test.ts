// ============================================================================
// format.ts 테스트 — 표시용 포매팅/라벨 헬퍼 (ralph-test)
// ----------------------------------------------------------------------------
// 계약 기준: DEV_ROLE_OPTIONS/EXPERIENCE_OPTIONS 라벨(contract.ts),
// 마감 뱃지 규약(null=상시 / 지남=마감 / 오늘 / D-1~3 urgent / D-4~7 soon).
// 시간 의존(daysUntilDeadline·deadlineInfo)은 vi.setSystemTime 으로 "오늘"을 고정.
// 고정 시각은 03:00Z — UTC(CI)와 KST(로컬) 어느 시간대에서도 같은 날짜가 되게.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  daysUntilDeadline,
  deadlineInfo,
  experienceLabel,
  formatDate,
  roleLabel,
  statusLabel,
} from "@/lib/format";

describe("roleLabel — 직무 value → 표시 라벨", () => {
  it("계약의 DEV_ROLE_OPTIONS 라벨을 돌려준다", () => {
    expect(roleLabel("backend")).toBe("백엔드 개발");
    expect(roleLabel("data")).toBe("데이터 엔지니어"); // 12.10 라벨 정정
    expect(roleLabel("ai-ml")).toBe("AI/ML 엔지니어·리서치"); // 12.10 신설
  });

  it("모르는 값은 원문 그대로, null 은 null", () => {
    expect(roleLabel("정보통신")).toBe("정보통신"); // 잡알리오 coarse 값 대비
    expect(roleLabel(null)).toBeNull();
    expect(roleLabel("")).toBeNull(); // 빈 문자열도 falsy → null
  });
});

describe("experienceLabel / statusLabel — enum → 라벨", () => {
  it("경력 enum 3종", () => {
    expect(experienceLabel("NEW")).toBe("신입");
    expect(experienceLabel("EXPERIENCED")).toBe("경력");
    expect(experienceLabel("ANY")).toBe("경력무관");
  });

  it("북마크 상태 3종", () => {
    expect(statusLabel("PLANNED")).toBe("지원 예정");
    expect(statusLabel("APPLIED")).toBe("지원함");
    expect(statusLabel("CLOSED")).toBe("마감");
  });
});

describe("formatDate — ISO → YYYY.MM.DD (UTC 기준)", () => {
  it("날짜만·시각 포함 모두 UTC 날짜로 찍는다", () => {
    expect(formatDate("2026-07-05")).toBe("2026.07.05");
    // +0900 은 UTC 로는 전날/같은날 경계 — UTC 기준이므로 07-31
    expect(formatDate("2026-07-31T23:59:59+0900")).toBe("2026.07.31");
  });

  it("null·해석 불가 문자열은 '-'", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate("상시채용")).toBe("-");
    expect(formatDate("")).toBe("-");
  });
});

describe("daysUntilDeadline / deadlineInfo — 오늘 = 2026-07-01 고정", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T03:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("남은 일수: 오늘 0, 미래 양수, 지남 음수", () => {
    expect(daysUntilDeadline("2026-07-01")).toBe(0);
    expect(daysUntilDeadline("2026-07-03")).toBe(2);
    expect(daysUntilDeadline("2026-06-30")).toBe(-1);
  });

  it("null → 상시(always)", () => {
    expect(deadlineInfo(null)).toEqual({ label: "상시", tone: "always", full: "상시채용" });
  });

  it("지남 → 마감(closed), 오늘 → 오늘 마감(urgent)", () => {
    expect(deadlineInfo("2026-06-28").tone).toBe("closed");
    expect(deadlineInfo("2026-06-28").label).toBe("마감");
    expect(deadlineInfo("2026-07-01")).toEqual({
      label: "오늘 마감",
      tone: "urgent",
      full: "오늘 마감",
    });
  });

  it("구간 경계: D-3 까지 urgent, D-4~7 soon, D-8+ normal", () => {
    expect(deadlineInfo("2026-07-04")).toEqual({ label: "D-3", tone: "urgent", full: "마감 3일 전" });
    expect(deadlineInfo("2026-07-05").tone).toBe("soon"); // D-4
    expect(deadlineInfo("2026-07-08")).toEqual({ label: "D-7", tone: "soon", full: "마감 7일 전" });
    expect(deadlineInfo("2026-07-09").tone).toBe("normal"); // D-8
    expect(deadlineInfo("2026-07-09").label).toBe("D-8");
  });
});
