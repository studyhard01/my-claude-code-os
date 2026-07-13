#!/usr/bin/env bash
# 개발 루프 지도(docs/dev-loop-map.html) 신선도 유지용 PostToolUse(Edit|Write) hook.
#
# 루프를 구성하는 파일(훅 스크립트·스킬·settings.json·CI 워크플로)이 수정되면
# "지도도 함께 갱신하라"는 컨텍스트를 모델에게 주입한다(additionalContext).
# 지도는 사람이 기억해서 고치는 문서가 아니라, 루프가 바뀔 때마다
# 이 훅이 갱신을 촉구하는 살아있는 문서다.
#
# ── 왜 이렇게 만들었나 ────────────────────────────────────────
# 1) 훅이 지도를 직접 고치지 않는다. "무엇이 어떻게 바뀌었는지"의 의미 해석은
#    모델 몫이므로, 훅은 감지·촉구까지만 책임진다(감지=기계, 해석=모델 분업).
# 2) 지도 파일 자체의 수정은 무시한다 — 지도 갱신이 다시 갱신 촉구를 낳는
#    무한 메아리 방지.
# 3) 진행 기록(ralph-test-progress 등)·로그는 대상이 아니다. 루프의 "구조"가
#    바뀔 때만 반응한다.
# 4) jq 없이 sed 만 쓴다. 실패해도 도구 실행에 영향 없도록 항상 exit 0.
#
# [실측 2026-07-13] 등록 직후 같은 세션에서 바로 동작했다(첫 발화: retrospect
#        SKILL.md Write 감지). "다음 세션부터"라는 통념과 달랐다 — LESSONS.md 참조.

set -uo pipefail

payload="$(cat 2>/dev/null)" || exit 0

# payload → 수정된 파일 경로 (decision-log.sh 와 같은 방식)
fpath="$(printf '%s' "$payload" | tr -d '\n\r' \
  | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  | sed -e 's/\\\\/\\/g' | tr '\\' '/')"
[ -n "$fpath" ] || exit 0

# 루프 구조를 이루는 파일인가? (지도 자신은 제외)
case "$fpath" in
  */docs/dev-loop-map.html) exit 0 ;;
  */.claude/hooks/*.sh)        surface="훅" ;;
  */.claude/skills/*/SKILL.md) surface="스킬" ;;
  */.claude/settings.json)     surface="훅 등록(settings.json)" ;;
  */.github/workflows/*)       surface="CI 워크플로" ;;
  *) exit 0 ;;
esac

fname="${fpath##*/}"

CONTEXT="[loop-map-context] 루프 구성 변경 감지 — ${surface} 파일 \`${fname}\` 이 수정됐다.
개발 루프 지도가 현실과 어긋나지 않도록, 이 작업 단위가 끝나면:
1. \`docs/dev-loop-map.html\` 의 해당 부분(레인 카드·진단 카드)을 현실에 맞게 고치고, 하단 [변경 이력] 절에 날짜와 함께 한 줄을 추가한다.
2. Artifact 도구로 재발행한다 — 반드시 url 파라미터에 https://claude.ai/code/artifact/ab4bf390-1a85-4cc6-8061-f38ed7744796 를 넣어 같은 주소를 유지할 것.
단, 루프 구조에 영향 없는 수정(오타·주석·문구)이면 지도 갱신을 생략하되, 생략했다는 판단을 사용자에게 한 줄 보고할 것."

# JSON string 이스케이프 (skill-context.sh 와 동일)
json_escape() {
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' -e 's/\r//g' \
    | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g'
}

CONTEXT_JSON="$(printf '%s' "$CONTEXT" | json_escape)" || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' \
  "$CONTEXT_JSON"

exit 0
