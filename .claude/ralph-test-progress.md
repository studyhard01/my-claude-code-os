# ralph-test 진행 상태

> `ralph-test` 스킬이 매 바퀴 읽고 갱신하는 **유일한** 진행 기록.
> 규칙: 한 바퀴에 한 항목만 `- [x]` 로 전환, 테스트 파일과 함께 커밋.
> 건너뛴 항목·발견한 소스 버그는 아래 ⛔ 메모에 사유와 함께 기록.

## 대상 목록 (우선순위순)

- [x] `src/lib/collect/normalizer.ts` — 순수 로직. 라벨 매핑·experience 해석·dedupKey·FULL/PARTIAL 판정 (OS.md 12.8) → `tests/lib/collect/normalizer.test.ts` 15개 (2026-07-09, 세팅 겸 수동 1바퀴)
- [x] `src/lib/format.ts` — 순수 로직. 라벨 변환·날짜 포맷·마감 뱃지(deadlineInfo) → `tests/lib/format.test.ts` 17개 (2026-07-14, 2바퀴)
- [x] `src/lib/collect/alio-adapter.ts` — (루프 밖에서 완료) 07-14 잡알리오 피벗 작업이 테스트 동반 구현 → `tests/lib/collect/alio-adapter.test.ts`
- [ ] `src/lib/serialize.ts` — 순수 로직. Prisma Job → JobDTO 직렬화 (OS.md 12.3/12.4)
- [ ] `src/lib/collect/saramin-adapter.ts` — fetchFn 주입으로 네트워크 없이 테스트 가능. 페이지 순회·5콜 상한·관대한 파싱
- [ ] `src/lib/api.ts` — fetch 목킹 필요. 쿼리 직렬화·에러 처리
- [ ] `src/app/api/jobs/route.ts` — DB 필요(후순위). 정렬·필터·totalCount 규약 (OS.md 12.6)
- [ ] `src/app/api/bookmarks/route.ts` + `[id]/route.ts` — DB 필요(후순위)
- [ ] `scripts/collect.ts` — DB 필요(후순위). idempotent upsert(재실행 시 신규 0)

## ⛔ 메모 (건너뜀·발견된 버그)

(없음)

## 📚 배운 것 (누적 — 매 바퀴 시작 시 읽고, 새 배움은 한 줄로 추가)

> 기록 규칙은 SKILL.md 참조: "다음 바퀴의 행동을 바꾸는 지식"만, 한 줄로.

- (1바퀴, 2026-07-09) 기대값을 짐작으로 쓰지 말고 소스를 먼저 읽을 것 — `RawJob.raw` 는 필수 필드라 빈 객체 `{}` 여도 `rawData` 는 null 이 아니라 `"{}"` 로 저장된다(A-3 원문 보존).
- (2바퀴, 2026-07-14) 시간 고정(`vi.setSystemTime`)은 **03:00Z처럼 UTC와 KST 어느 시간대에서도 같은 날짜가 되는 시각**으로 — 소스가 로컬/UTC 날짜를 섞어 쓰므로(daysUntilDeadline), 20:00Z 같은 경계 시각이면 CI(UTC)와 로컬(KST)의 "오늘"이 달라져 한쪽만 깨진다.
- (1바퀴, 2026-07-09) 날짜 기대값은 UTC 로 계산해 리터럴로 박는다 — 예: `"2026-07-31T23:59:59+0900"` → `"2026-07-31T14:59:59.000Z"`. 테스트 안에서 `new Date()` 로 재계산하면 검증이 무의미해진다.
