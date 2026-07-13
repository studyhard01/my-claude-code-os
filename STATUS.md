# STATUS — 현재 진행 상태

> **살아있는 상태(現況) 문서.** `OS.md`가 "무엇을·왜 만들 것인가"(계획, 잘 안 변함)라면,
> 이 파일은 "지금 어디까지 왔나"(현황, 자주 변함)를 담는다. 세션·서브에이전트가 시작할 때
> 여기부터 보면 "지금 뭘 해야 하는지"를 즉시 안다. **작업이 끝나거나 막히면 이 파일을 갱신한다.**
>
> 갱신 규칙: 완료→✅로 옮기고, 새로 막히면 ⛔에 추가, "다음 할 일"을 항상 1~3개 유지.

- **최종 갱신**: 2026-07-13 (루프 엔지니어링 — 지도 자동 갱신 훅 + `/retrospect` 교훈 누적 체계)
- **현재 마일스톤**: **M1 — 공고 모아보기 MVP** (직무 범위: 개발직군 한정)
- **한 줄 요약**: 수집 파이프라인(SaraminAdapter→Normalizer→upsert)이 fixture 로 end-to-end 검증 완료. **남은 건 사람인 API 승인 후 `COLLECT_SOURCE=saramin` 전환뿐.**

---

## ✅ 완료

- 개발 실행 구조·계약 확정 (OS.md 12장)
- 협업 인프라: 공유 서브에이전트 3 + 스킬 5 + 훅 2 (상세 = README.md)
- 앱 스캐폴딩 + 공유 계약 `src/types/contract.ts`
- 4화면 UI: 온보딩 / 피드 / 상세 / 저장
- 실 DB 읽기(Prisma + SQLite), 북마크 CRUD, `role` 다중값 필터
- API 엔드포인트 8종 (GET /api/jobs … DELETE /api/bookmarks/:id)
- 컨텍스트 보강: CLAUDE.md 항상-참인 사실 주입
- **`status-context` 훅(SessionStart)** — 이 파일(`STATUS.md`)을 매 세션 자동 주입. "먼저 확인하라"는 부탁을 보장으로 전환. `jq` 없이 `sed`만 사용
- **`contract-context` 훅(SubagentStart)** — `src/types/contract.ts` 전문을 개발 에이전트(backend/frontend)에만 주입. payload 의 `agent_type` 으로 분기(실측 확인)
- **`decision-log` 훅 복구** — `jq` 의존 제거(`sed` 파싱), 스냅샷 diff 로 **바뀐 절 이름**까지 기록, 파싱 실패 시 `.claude/decision-log.err` 에 흔적. 2026-07-05 이후 조용히 죽어 있던 것을 살림
- **`skill-usage-log` 훅 복구·등록** — `jq` 의존 제거, JSON 상태 파일 → append 전용 로그(`.claude/skill-usage.log`)로 전환, 기록 위치를 프로젝트 안으로 이동, `settings.json` 에 등록. `skill-stat` 도 `awk` 집계로 재작성 (**훅 6개, 실행 코드에 `jq` 0곳**)
- **컨텍스트 설계 문서 `docs/context.md`** — 도식(mermaid), 훅 5개 설명, 설계 원칙. **A/B 테스트로 계약 주입 효과 실측**: 정답률은 동일하나 도구 호출 2→0, 토큰 −14%, 시간 −22%. 실험 중 "SubagentStart 훅은 같은 세션에서 바로 돈다"는 사실을 발견(PreToolUse 는 안 돎)
- **피드 정렬·필터 UX 개선** (orchestrate 시연) — `sort=recent` 정렬·집계 규약 구현(`totalCount` 부분집합 버그 수정), 필터↔URL 동기화(새로고침·공유 복원), 적용된 필터 칩·"필터 전체 해제". 계약 모호점을 OS.md 12.6/6장에 명문화(DECISIONS.md 자동 기록)
- **수집 파이프라인 구현 (OS.md 12.8)** — fixture(`saramin-job-search.json`, FULL 5+PARTIAL 4) → `SaraminAdapter`(fetchFn 주입, 실행당 최대 5콜) → `Normalizer`(name 키워드 라벨 매핑·dedupKey·dataQuality) → `scripts/collect.ts`(`COLLECT_SOURCE` 스위치, idempotent upsert). `saramin-fixture` 모드로 수집→upsert→`GET /api/jobs` 노출까지 검증(재실행 시 신규 0 확인)

- **루프 지도(`docs/dev-loop-map.html`) + 자동 갱신 훅 `loop-map-context`** — 개발 루프를 사람·AI·CI 3레인으로 시각화(병목/반복/낭비 진단·변경 이력 포함). 루프 구성 파일(훅·스킬·settings·CI)이 수정되면 훅이 "지도 갱신·재발행" 컨텍스트를 자동 주입(**훅 스크립트 6개**, 등록 당일 같은 세션에서 동작 실측). 발행 주소는 지도 파일 머리 주석에
- **`/retrospect` + `LESSONS.md`** — 세션(루프) 끝에 "다음 세션의 행동을 바꾸는 지식"만 누적(세션당 최대 5줄, 항상 필요한 건 CLAUDE.md 승격). ralph-test 종료 시 자동 실행. 루프 지도의 **반복 ① 해소** — 최초 진단 6건 중 4건 해소, 남은 건 병목 2(사람 승인=유지, 사람인 API=외부)
- **루프 진단 후 낭비 2건 해소** — ① CI 도입(`.github/workflows/ci.yml`: push/PR 마다 db:push→typecheck→test. 원격=백업→검문소) ② `/commit` 스킬에 검증 게이트("초록불 없이 커밋 금지", 문서-only 커밋만 예외). 홈(`~/.claude`)·프로젝트 두 commit 스킬 동기화. **CI 첫 실행 성공 확인(2026-07-13, run #1, 32초)** — 검문소 가동
- **`ralph-test` 랄프 루프 스킬 + Vitest 도입** — "한 호출 = 한 바퀴(모듈 1개 테스트→통과 확인→커밋→기록)" 구조, 반복은 `/loop /ralph-test` 가 담당. 진행 상태 = `.claude/ralph-test-progress.md`(대상 8건, 우선순위순). 첫 바퀴(Normalizer 15개 테스트)로 절차 검증 완료

## 🚧 진행 중 · 남은 것 (M1)

- **테스트 채우기** — `/loop /ralph-test` 로 남은 대상 7건 소진 (`.claude/ralph-test-progress.md` 참조)

- **Mock → 실 API 교체 통합** — 사람인 승인 후 `COLLECT_SOURCE=saramin` + `SARAMIN_ACCESS_KEY` 로 전환, 실응답 필드명·구조 최종 검증(12.8)

## ⛔ 블로킹 · 대기

- **사람인 개발자센터 이용신청 → 승인 대기 중.** 승인 전까지 실 수집 불가 → `MockAdapter`로 진행.
  - 승인 후 제약: 하루 500콜 / 요청당 count ≈ 110. 약관: 재판매·대가 수취 금지.

## ▶️ 다음 할 일 (우선순위)

1. 사람인 API 승인 확인 → `SARAMIN_ACCESS_KEY` 설정 → `COLLECT_SOURCE=saramin npm run collect` 로 실수집, 실응답 필드명·구조를 fixture 가정과 대조(12.8 "승인 후 최종 검증")
2. 실 데이터 유입 후 name 키워드 매핑 커버리지 점검(매핑 실패→PARTIAL 비율이 높으면 키워드 테이블 보강)
3. **M1 완료 기준 검증**: "온보딩→피드→북마크"가 실 데이터로 끝까지 도는가

## 관련 문서

- 계획·계약: `OS.md` (특히 9장 로드맵, 12장 개발 구조)
- OS 구성: `README.md` · `CLAUDE.md`
- 결정 변경 이력(자동): `DECISIONS.md`
