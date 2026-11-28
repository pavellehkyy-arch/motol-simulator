#!/usr/bin/env bash
# Rychlý recept na testy.
#   tests/rychle.sh          – rychlé testy (unit, bez prohlížeče), pár sekund
#   tests/rychle.sh --net    – navíc oba online e2e testy (scratch i sprint) najednou, se zkráceným závodem
# Online e2e pouštěj jen při změně online závodu (race-net.js, bloky ZÁVOD ONLINE / sprint online v index.html).
# KOLA_SCRATCH / KOLA_SPRINT přepíšou délku závodu v testech (výchozí 4 a 2 kola), WS=1 = přes server.
set -u
cd "$(dirname "$0")/.."
t0=$(date +%s)
node --test tests/*.test.js 2>&1 | grep -E '^# (tests|pass|fail)|^not ok' ; unit=${PIPESTATUS[0]}
echo "unit testy: $([ "$unit" = 0 ] && echo OK || echo CHYBA) ($(( $(date +%s) - t0 )) s)"
[ "${1:-}" = "--net" ] || exit "$unit"

T=/tmp/three-r128; if [ ! -f $T/package/build/three.min.js ]; then mkdir -p $T && (cd $T && npm pack three@0.128.0 >/dev/null 2>&1 && tar xzf three-0.128.0.tgz); fi
export THREE_PATH=$T/package/build/three.min.js
L=$(mktemp -d)
KOLA=${KOLA_SCRATCH:-4} node tests/e2e-race.js > "$L/scratch.txt" 2>&1 & p1=$!
KOLA=${KOLA_SPRINT:-2} node tests/e2e-sprint.js > "$L/sprint.txt" 2>&1 & p2=$!
wait $p1; r1=$?; wait $p2; r2=$?
for n in scratch sprint; do echo "--- e2e $n: $(grep -c '^OK' "$L/$n.txt") OK, $(grep -c '^FAIL' "$L/$n.txt") FAIL"; grep -v '^OK' "$L/$n.txt" | head -15; done
echo "celkem $(( $(date +%s) - t0 )) s"
[ "$unit" = 0 ] && [ $r1 = 0 ] && [ $r2 = 0 ]
