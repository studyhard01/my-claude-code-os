# ralph-test 진행 상태

> `ralph-test` 스킬이 매 바퀴 읽고 갱신하는 **유일한** 진행 기록.
> 규칙: 한 바퀴에 한 항목만 `- [x]` 로 전환, 테스트 파일과 함께 커밋.
> 건너뛴 항목·발견한 소스 버그는 아래 ⛔ 메모에 사유와 함께 기록.

## 대상 목록 (우선순위순)

- [x] `src/lib/collect/normalizer.ts` — 순수 로직. 라벨 매핑·experience 해석·dedupKey·FULL/PARTIAL 판정 (OS.md 12.8) → `tests/lib/collect/normalizer.test.ts` 15개 (2026-07-09, 세팅 겸 수동 1바퀴)
- [x] `src/lib/format.ts` — 순수 로직. 라벨 변환·날짜 포맷·마감 뱃지(deadlineInfo) → `tests/lib/format.test.ts` 17개 (2026-07-14, 2바퀴)
- [x] `src/lib/collect/alio-adapter.ts` — (루프 밖에서 완료) 07-14 잡알리오 피벗 작업이 테스트 동반 구현 → `tests/lib/collect/alio-adapter.test.ts`
- [x] `src/lib/serialize.ts` — 순수 로직. Prisma Job → JobDTO 직렬화 (OS.md 12.3/12.4) → `tests/lib/serialize.test.ts` 8개 (2026-07-14, 3바퀴. Prisma 행은 리터럴로 흉내 — DB 불필요)
- [x] `src/lib/collect/saramin-adapter.ts` — fetchFn 주입으로 네트워크 없이 테스트. 페이지 순회·5콜 상한·관대한 파싱·부분 실패 허용 → `tests/lib/collect/saramin-adapter.test.ts` 10개 (2026-07-14, 4바퀴)
- [x] `src/lib/api.ts` — 쿼리 직렬화·역직렬화(왕복 보존)·에러 변환·204 처리. 전역 fetch 는 `vi.stubGlobal` 로 목킹 → `tests/lib/api.test.ts` 14개 (2026-07-14, 5바퀴)
- [x] `src/app/api/jobs/route.ts` — 정렬·필터·PARTIAL 집계·커서 규약 (OS.md 12.6) → `tests/app/api/jobs/route.test.ts` 8개 (2026-07-14, 6바퀴. 테스트 전용 prisma/test.db 격리 구축)
- [x] `src/app/api/bookmarks/route.ts` + `[id]/route.ts` — POST idempotent·저장 목록(마감 포함)·status 검증·404·204 → `tests/app/api/bookmarks/routes.test.ts` 7개 (2026-07-14, 7바퀴. 6바퀴 격리 패턴 재사용)
- [x] `scripts/collect.ts` — 자식 프로세스(tsx)로 실제 실행해 end-to-end 검증: fixture 2종 적재, 재실행 신규 0(idempotent), 키 없는 실 소스·미지 소스 즉시 실패 → `tests/scripts/collect.test.ts` 4개 (2026-07-14, 8바퀴)

## ⛔ 메모 (건너뜀·발견된 버그)

(없음)

## 📚 배운 것 (누적 — 매 바퀴 시작 시 읽고, 새 배움은 한 줄로 추가)

> 기록 규칙은 SKILL.md 참조: "다음 바퀴의 행동을 바꾸는 지식"만, 한 줄로.

- (1바퀴, 2026-07-09) 기대값을 짐작으로 쓰지 말고 소스를 먼저 읽을 것 — `RawJob.raw` 는 필수 필드라 빈 객체 `{}` 여도 `rawData` 는 null 이 아니라 `"{}"` 로 저장된다(A-3 원문 보존).
- (8바퀴, 2026-07-14) **import 즉시 main() 이 도는 스크립트는 리팩터링하지 말고 자식 프로세스로 실행해 테스트** — `execSync("npx tsx <스크립트>", {env: {...process.env, DATABASE_URL: "file:./test.db"}})` 로 실행 후 같은 test.db 를 prisma 로 검증. 실패 검증은 execSync 의 throw 를 잡아 status/stderr 확인. 소스 무수정 원칙과 격리를 동시에 지킨다.
- (6바퀴, 2026-07-14) **DB 라우트 테스트 격리 패턴이 구축돼 있다**: globalSetup(`tests/setup/global-db.ts`)이 `prisma/test.db` 에 스키마 push, setupFiles(`env-db.ts`)가 import 전에 DATABASE_URL 교체, `fileParallelism:false` 로 경합 방지. 다음 DB 테스트(bookmarks·collect)는 `mkJob`+`deleteMany` 패턴만 따라 쓰면 된다. 만료 판정 등 실시간 의존은 먼 과거(2020)/미래(2030) 날짜로 회피.
- (4바퀴, 2026-07-14) `vi.fn(async () => …)` 처럼 **인자 없는 구현으로 만든 mock 은 `mock.calls[0][0]` 접근이 타입 오류**(tuple `[]`) — 호출 인자를 검증할 mock 은 시그니처를 인자에 명시(`vi.fn(async (_input: RequestInfo | URL) => …)`). 테스트는 통과해도 typecheck 가 잡는다.
- (2바퀴, 2026-07-14) 시간 고정(`vi.setSystemTime`)은 **03:00Z처럼 UTC와 KST 어느 시간대에서도 같은 날짜가 되는 시각**으로 — 소스가 로컬/UTC 날짜를 섞어 쓰므로(daysUntilDeadline), 20:00Z 같은 경계 시각이면 CI(UTC)와 로컬(KST)의 "오늘"이 달라져 한쪽만 깨진다.
- (1바퀴, 2026-07-09) 날짜 기대값은 UTC 로 계산해 리터럴로 박는다 — 예: `"2026-07-31T23:59:59+0900"` → `"2026-07-31T14:59:59.000Z"`. 테스트 안에서 `new Date()` 로 재계산하면 검증이 무의미해진다.
