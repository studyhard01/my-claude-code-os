# ralph-test 진행 상태

> `ralph-test` 스킬이 매 바퀴 읽고 갱신하는 **유일한** 진행 기록.
> 규칙: 한 바퀴에 한 항목만 `- [x]` 로 전환, 테스트 파일과 함께 커밋.
> 건너뛴 항목·발견한 소스 버그는 아래 ⛔ 메모에 사유와 함께 기록.

## 대상 목록 (우선순위순)

- [x] `src/lib/collect/normalizer.ts` — 순수 로직. 라벨 매핑·experience 해석·dedupKey·FULL/PARTIAL 판정 (OS.md 12.8) → `tests/lib/collect/normalizer.test.ts` 15개 (2026-07-09, 세팅 겸 수동 1바퀴)
- [ ] `src/lib/format.ts` — 순수 로직. 라벨 변환·날짜 포맷·마감 뱃지(deadlineInfo). ⚠ `new Date()` 의존 → 오늘 날짜 고정(vi.setSystemTime) 필요
- [ ] `src/lib/serialize.ts` — 순수 로직. Prisma Job → JobDTO 직렬화 (OS.md 12.3/12.4)
- [ ] `src/lib/collect/saramin-adapter.ts` — fetchFn 주입으로 네트워크 없이 테스트 가능. 페이지 순회·5콜 상한·관대한 파싱
- [ ] `src/lib/api.ts` — fetch 목킹 필요. 쿼리 직렬화·에러 처리
- [ ] `src/app/api/jobs/route.ts` — DB 필요(후순위). 정렬·필터·totalCount 규약 (OS.md 12.6)
- [ ] `src/app/api/bookmarks/route.ts` + `[id]/route.ts` — DB 필요(후순위)
- [ ] `scripts/collect.ts` — DB 필요(후순위). idempotent upsert(재실행 시 신규 0)

## ⛔ 메모 (건너뜀·발견된 버그)

(없음)
