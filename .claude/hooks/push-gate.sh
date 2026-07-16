#!/bin/bash
# ============================================================================
# push-gate — PreToolUse(Bash) 훅: "push 는 평가가 허가한다"를 기계로 강제
# ----------------------------------------------------------------------------
# CLAUDE.md 의 두 규칙을 부탁에서 보장으로 바꾼다:
#   1) force push 금지(07-13·07-14 이틀 연속 갈라짐 사고) → 무조건 deny
#   2) push 는 /ship(npm run eval 100/100)으로만 → 평가 통과 표식
#      (.claude/.eval-pass, evaluate.ts 가 PASS 때 갱신)이 15분 내로 신선하면
#      allow, 아니면 ask(사용자 확인). deny 가 아니라 ask 인 이유: 계약
#      Draft PR 브랜치 push 처럼 평가와 무관한 정당한 push 흐름이 있다 —
#      기계가 판별 못 하는 것은 막지 말고 사람에게 넘긴다.
#
# 규약(CLAUDE.md): jq 금지(sed/awk 만), GNU 전용 옵션 금지(BSD 호환),
#   조용히 실패하지 않는다(파싱 실패 → .claude/push-gate.err), 항상 exit 0.
# 주의: settings.json 에 새로 등록한 PreToolUse 훅은 **다음 세션부터** 돈다
#   (docs/context.md 실측). 등록 후 반드시 다음 세션에서 발화를 확인할 것.
# ============================================================================

payload="$(cat)"
proj="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# tool_input.command 값만 추출 — 이스케이프(\")를 넘어 닫는 따옴표까지 스캔.
# (description 등 다른 필드의 "git push" 문구에 오탐하지 않기 위해 필드를 특정한다)
cmd="$(printf '%s' "$payload" | awk '
  {
    i = index($0, "\"command\":\"")
    if (i == 0) next
    s = substr($0, i + 11)
    out = ""
    for (j = 1; j <= length(s); j++) {
      c = substr(s, j, 1)
      if (c == "\\") { out = out c substr(s, j+1, 1); j++; continue }
      if (c == "\"") break
      out = out c
    }
    print out
    exit
  }')"

if [ -z "$cmd" ]; then
  # Bash 도구인데 command 를 못 읽었다 — 흔적을 남기되 작업은 막지 않는다.
  printf '%s command 필드 파싱 실패 (payload %s bytes)\n' \
    "$(date -u +%Y-%m-%dT%H:%MZ)" "${#payload}" >> "$proj/.claude/push-gate.err"
  exit 0
fi

# git push 가 아닌 명령은 통과 (JSON 출력 없이 exit 0 = 개입 안 함)
case "$cmd" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

# ── 1) force push → 무조건 deny ─────────────────────────────────────────
# 같은 명령 조각(&&, ;, | 경계 안)에서 git push 와 force 플래그가 함께 있는지 본다.
if printf '%s' "$cmd" | awk '
  BEGIN { bad = 0 }
  {
    n = split($0, seg, /(&&|;|\|)/)
    for (k = 1; k <= n; k++) {
      if (seg[k] ~ /git +push/ && seg[k] ~ /(--force|--force-with-lease| -f( |$))/) bad = 1
    }
  }
  END { exit bad ? 0 : 1 }'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"force push 금지 (CLAUDE.md — 07-13·07-14 이틀 연속 원격 갈라짐 사고). 브랜치 재구성은 PR 병합으로만."}}\n'
  exit 0
fi

# ── 2) 일반 push → 평가 통과 표식이 신선하면 allow, 아니면 ask ──────────
# find -mmin 은 BSD/GNU 양쪽에 있다 (stat 은 플래그가 갈려서 안 쓴다).
if [ -f "$proj/.claude/.eval-pass" ] && \
   [ -n "$(find "$proj/.claude/.eval-pass" -mmin -15 2>/dev/null)" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"push 게이트: 15분 내 npm run eval 100/100 통과 표식 확인."}}\n'
  exit 0
fi

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"push 게이트: 최근 15분 내 평가 통과 표식(.claude/.eval-pass)이 없습니다. push 는 /ship(npm run eval)으로 하는 것이 규칙입니다 — 계약 Draft PR 브랜치 등 평가와 무관한 push 라면 승인하세요."}}\n'
exit 0
