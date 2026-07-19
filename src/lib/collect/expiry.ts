// ============================================================================
// 만료 판정 — 수집 시 만료 공고 스킵 (M2 위생 조각, OS.md 9장 2026-07-17)
// ----------------------------------------------------------------------------
// 피드 API(src/app/api/jobs/route.ts, 12.6)와 **같은 경계**를 쓴다:
//   만료 = deadline 이 있고, "오늘(UTC 자정)"보다 이전.
//   - 오늘 마감인 공고는 만료가 아니다(피드의 `deadline >= startOfToday` 와 대칭).
//   - 상시채용(deadline=null)은 만료가 아니다.
// 경계가 두 곳에서 어긋나면 "수집은 했는데 피드에 안 보이는" 공고나 그 반대가
// 생기므로, 이 파일이 바뀌면 route.ts 의 경계도 함께 봐야 한다.
// ============================================================================

/** now 가 속한 UTC 날짜의 자정 (route.ts startOfToday 와 동일 계산) */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * 정규화된 deadline(ISO 문자열 | null)이 now 기준으로 만료인가.
 * null(상시채용) → false. 해석 불가 문자열은 Normalizer 가 이미 null 로 걸렀으므로
 * 여기 오지 않지만, 방어적으로 false(스킵하지 않음 — 데이터를 지우는 쪽이 더 위험).
 */
export function isExpiredDeadline(deadlineIso: string | null, now: Date): boolean {
  if (deadlineIso == null) return false;
  const deadline = new Date(deadlineIso);
  if (Number.isNaN(deadline.getTime())) return false;
  return deadline < startOfUtcDay(now);
}
