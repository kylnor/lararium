#!/usr/bin/env bash
# Corpus for lab's source validation.
#
#   060_lab/tests/test-secret-refusal.sh
#
# Drives the real `lab --check` code path, so the test cannot drift from the
# thing it tests. No docker daemon required: --check copies nothing and starts
# nothing.
#
# WHY THIS EXISTS
#
# Through v2.15 the refusal inspected only the BASENAME of the argument:
#
#     lab ~/.ssh     REFUSED
#     lab ~          ACCEPTED   <- docker cp'd .ssh, .gnupg, .aws into the box
#
# Naming a parent directory defeated the entire check, and with --net that is a
# working exfiltration path. It also broke the guarantee at the top of `lab`
# that nothing of yours is ever mounted in. The lesson is the same one the hooks
# layer learned: check what the thing IS, not what it is called.
set -uo pipefail

HERE="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB="$HERE/../lab"
TMP="$(mktemp -d -t lab-corpus.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0

# expect <refuse|accept> <path> <label>
expect() {
  local want="$1" path="$2" label="$3" out rc got
  out="$("$LAB" --check "$path" 2>&1)"; rc=$?
  [ "$rc" -eq 0 ] && got="accept" || got="refuse"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS+1)); printf '  PASS  %-52s %s\n' "$label" "$got"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  %-52s %s (wanted %s)\n' "$label" "$got" "$want"
    printf '%s\n' "$out" | sed 's/^/          /'
  fi
}

# expect_excluded <path> <needle> <label>
expect_excluded() {
  local path="$1" needle="$2" label="$3" out
  out="$("$LAB" --check "$path" 2>&1)"
  if printf '%s' "$out" | grep -q -- "$needle"; then
    PASS=$((PASS+1)); printf '  PASS  %-52s excluded\n' "$label"
  else
    FAIL=$((FAIL+1)); printf '  FAIL  %-52s NOT excluded\n' "$label"
    printf '%s\n' "$out" | sed 's/^/          /'
  fi
}

# ---- fixtures ----
mkdir -p "$TMP/home/.ssh" "$TMP/home/.gnupg" "$TMP/home/proj/src"
echo k > "$TMP/home/.ssh/id_ed25519"
echo c > "$TMP/home/proj/src/main.py"

mkdir -p "$TMP/cleanrepo/src"
echo c > "$TMP/cleanrepo/src/main.py"
echo "# readme" > "$TMP/cleanrepo/README.md"

mkdir -p "$TMP/envrepo/src"
echo c > "$TMP/envrepo/src/main.py"
echo "SECRET=x" > "$TMP/envrepo/.env"
echo "SECRET=y" > "$TMP/envrepo/.env.production"
echo "key" > "$TMP/envrepo/server.pem"

mkdir -p "$TMP/nested/vendor/tool/.aws"
echo c > "$TMP/nested/main.py"
echo cred > "$TMP/nested/vendor/tool/.aws/credentials"

echo "lab source validation"
echo
echo "-- the v2.15 hole: naming a parent must not launder its keys --"
expect refuse "$TMP/home"              "REGRESSION: parent dir containing .ssh/.gnupg"
expect refuse "$TMP/home/.ssh"         "the store named directly (basename fast path)"
expect refuse "$TMP/nested"            "REGRESSION: credential store nested 3 deep"

echo
echo "-- ordinary code must still go in, or the tool is useless --"
expect accept "$TMP/cleanrepo"         "clean repo"
expect accept "$TMP/home/proj"         "sibling of a store, but clean itself"
expect accept "$TMP/envrepo"           "repo with .env proceeds (not refused)"

echo
echo "-- dotenv-class files are stripped from the copy, not refused --"
expect_excluded "$TMP/envrepo" ".env"            ".env"
expect_excluded "$TMP/envrepo" ".env.production" ".env.production"
expect_excluded "$TMP/envrepo" "server.pem"      "server.pem"

echo
TOTAL=$((PASS+FAIL))
if [ "$FAIL" -gt 0 ]; then echo "$PASS/$TOTAL passed, $FAIL FAILED"; exit 1; fi
echo "$PASS/$TOTAL passed"
