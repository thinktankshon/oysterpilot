#!/usr/bin/env bash
# Claude Code の PreToolUse フック：Bash で git commit を実行する直前に .githooks/pre-commit と同じ検査を走らせる。
# 標準入力に tool_input の JSON が来る。commit 以外のコマンドは素通し。終了コード 2 で実行を止める。
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))
except Exception: print("")')
case "$cmd" in
  *"git commit"*)
    if ! "$(git rev-parse --show-toplevel)/.githooks/pre-commit" >&2; then
      echo "pre-commit 検査で止めました（実名・秘密情報）。" >&2
      exit 2
    fi
    ;;
esac
exit 0
