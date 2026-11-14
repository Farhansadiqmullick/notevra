#!/usr/bin/env bash
#
# The server half of sync, exercised the way the browser will actually reach it: two devices on one
# account, pushing operations through PostgREST as a logged-in user. Asserts, so it fails loudly.
#
# Why a shell script rather than a vitest case: none of what is under test is JavaScript. The
# conflict decision lives in `sync_push`, and RLS decides whether the call is even allowed — neither
# is reachable from `psql` as superuser, where RLS does not apply and every policy looks correct.
# This drives the same HTTP path the app will use, with a real JWT.
#
#   npm run db:verify      (requires: npm run db:start)
#
set -euo pipefail

ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
API="${SUPABASE_API_URL:-http://127.0.0.1:54321}"
J="Content-Type: application/json"
PASS=0
FAIL=0

ok ()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad ()  { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }
is ()   { [ "$2" = "$3" ] && ok "$1" || bad "$1" "$2" "$3"; }

# A distinct account per run, so a re-run never collides with rows left by the last one.
RUN=$(date +%s)
EMAIL="sync-check-$RUN@example.com"
CRED="{\"email\":\"$EMAIL\",\"password\":\"password123\"}"
curl -s -X POST "$API/auth/v1/signup" -H "apikey: $ANON" -H "$J" -d "$CRED" > /dev/null
TOK=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "$J" -d "$CRED" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

rpc () { curl -s -X POST "$API/rest/v1/rpc/$1" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H "$J" -d "$2"; }
# status of the nth outcome (0-based)
status () { python3 -c "import sys,json;print(json.load(sys.stdin)[$1]['status'])"; }
field ()  { python3 -c "import sys,json;print(json.load(sys.stdin)[$1].get('$2'))"; }

uuid () { python3 -c "import uuid;print(uuid.uuid4())"; }
WS=$(uuid); NOTE=$(uuid); BLK=$(uuid); BLK2=$(uuid)

echo "sync_push / sync_pull — two devices, one account"

# ---------------------------------------------------------------------------
echo "setup: device A creates a workspace, a page and two blocks"
OUT=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[
  {\"id\":\"o1\",\"entity\":\"workspace\",\"entityId\":\"$WS\",\"type\":\"CreateWorkspace\",\"version\":1,\"payload\":{\"name\":\"Personal\"}},
  {\"id\":\"o2\",\"entity\":\"note\",\"entityId\":\"$NOTE\",\"type\":\"CreateNote\",\"version\":1,\"payload\":{\"workspace_id\":\"$WS\",\"title\":\"Kernel Labs\",\"type\":\"planning\"}},
  {\"id\":\"o3\",\"entity\":\"block\",\"entityId\":\"$BLK\",\"type\":\"CreateBlock\",\"version\":1,\"payload\":{\"note_id\":\"$NOTE\",\"type\":\"task\",\"text\":\"Ship the scheduler\",\"position\":1}},
  {\"id\":\"o4\",\"entity\":\"block\",\"entityId\":\"$BLK2\",\"type\":\"CreateBlock\",\"version\":1,\"payload\":{\"note_id\":\"$NOTE\",\"type\":\"task\",\"text\":\"Write the RFC\",\"position\":2}}]}")
is "four creates all ack" "ack ack ack ack" \
   "$(echo "$OUT" | python3 -c "import sys,json;print(' '.join(o['status'] for o in json.load(sys.stdin)))")"

# ---------------------------------------------------------------------------
echo "pull: a device never receives its own operations back"
B_PULL=$(rpc sync_pull '{"device":"browser-b","cursor_seq":0}')
COUNT=$(echo "$B_PULL" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['ops']))")
# `seq` is a table-wide sequence, not per-account, so the absolute cursor depends on whatever else
# this database has ever done. Only its BEHAVIOUR is a contract: it advances, and re-pulling with it
# returns nothing.
CURSOR=$(echo "$B_PULL" | python3 -c "import sys,json;print(json.load(sys.stdin)['cursor'])")
A_PULL=$(rpc sync_pull '{"device":"browser-a","cursor_seq":0}')
SPENT=$(rpc sync_pull "{\"device\":\"browser-b\",\"cursor_seq\":$CURSOR}")

is "B sees A's 4 ops"        "4"    "$COUNT"
is "B's cursor advances"     "True" "$(python3 -c "print($CURSOR > 0)")"
is "A sees none of its own"  "0"    "$(echo "$A_PULL" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['ops']))")"
is "a spent cursor is empty" "0"    "$(echo "$SPENT" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['ops']))")"

# ---------------------------------------------------------------------------
echo "same block, same base version → conflict"
rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"a1\",\"entity\":\"block\",\"entityId\":\"$BLK\",\"type\":\"UpdateBlock\",\"version\":2,\"payload\":{\"text\":\"Ship the scheduler by Friday\"}}]}" > /dev/null
OUT=$(rpc sync_push "{\"device\":\"browser-b\",\"ops\":[{\"id\":\"b1\",\"entity\":\"block\",\"entityId\":\"$BLK\",\"type\":\"UpdateBlock\",\"version\":2,\"payload\":{\"text\":\"Ship the scheduler next sprint\"}}]}")
is "B's late edit conflicts"     "conflict" "$(echo "$OUT" | status 0)"
is "it carries serverVersion"    "2"        "$(echo "$OUT" | field 0 serverVersion)"
is "and the server's own text"   "Ship the scheduler by Friday" \
   "$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['serverPayload']['text'])")"
is "the loser does NOT overwrite" "Ship the scheduler by Friday" \
   "$(curl -s "$API/rest/v1/blocks?select=text&id=eq.$BLK" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['text'])")"

# ---------------------------------------------------------------------------
echo "different blocks in one page → no conflict, both survive"
# Assigned to a variable first, never interpolated inline: a `$(rpc … "{\"…\"}")` nested inside
# another double-quoted string loses its escapes and PostgREST answers PGRST102 "invalid json",
# which then reads as a broken function rather than a broken quote.
OUT=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"a2\",\"entity\":\"block\",\"entityId\":\"$BLK\",\"type\":\"UpdateBlock\",\"version\":3,\"payload\":{\"text\":\"A edits block one\"}}]}")
is "A's edit to block one acks" "ack" "$(echo "$OUT" | status 0)"
OUT=$(rpc sync_push "{\"device\":\"browser-b\",\"ops\":[{\"id\":\"b2\",\"entity\":\"block\",\"entityId\":\"$BLK2\",\"type\":\"UpdateBlock\",\"version\":2,\"payload\":{\"text\":\"B edits block two\"}}]}")
is "B's edit to block two acks" "ack" "$(echo "$OUT" | status 0)"

# ---------------------------------------------------------------------------
echo "one side deletes, the other edits → 'deleted', not a version conflict"
rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"a3\",\"entity\":\"block\",\"entityId\":\"$BLK2\",\"type\":\"DeleteBlock\",\"version\":3,\"payload\":{}}]}" > /dev/null
OUT=$(rpc sync_push "{\"device\":\"browser-b\",\"ops\":[{\"id\":\"b3\",\"entity\":\"block\",\"entityId\":\"$BLK2\",\"type\":\"UpdateBlock\",\"version\":4,\"payload\":{\"text\":\"B was still typing\"}}]}")
is "edit of a deleted row"        "deleted" "$(echo "$OUT" | status 0)"
is "carries when it was deleted"  "True" \
   "$(echo "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)[0].get('deletedAt',0) > 0)")"

echo "a second delete is agreement, not a clash"
OUT=$(rpc sync_push "{\"device\":\"browser-b\",\"ops\":[{\"id\":\"b4\",\"entity\":\"block\",\"entityId\":\"$BLK2\",\"type\":\"DeleteBlock\",\"version\":5,\"payload\":{}}]}")
is "delete of a deleted row acks" "ack" "$(echo "$OUT" | status 0)"

# ---------------------------------------------------------------------------
echo "an operation patches only the fields it carries"
rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"a4\",\"entity\":\"block\",\"entityId\":\"$BLK\",\"type\":\"UpdateBlock\",\"version\":4,\"payload\":{\"checked\":true}}]}" > /dev/null
is "text survives a checked-only op" "A edits block one" \
   "$(curl -s "$API/rest/v1/blocks?select=text&id=eq.$BLK" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['text'])")"

# ---------------------------------------------------------------------------
echo "RLS still applies through the function"
OTHER="{\"email\":\"intruder-$(date +%s)@example.com\",\"password\":\"password123\"}"
curl -s -X POST "$API/auth/v1/signup" -H "apikey: $ANON" -H "$J" -d "$OTHER" > /dev/null
TOK2=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "$J" -d "$OTHER" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
INTRUDE=$(curl -s -X POST "$API/rest/v1/rpc/sync_push" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
  -d "{\"device\":\"attacker\",\"ops\":[{\"id\":\"x1\",\"entity\":\"block\",\"entityId\":\"$BLK\",\"type\":\"UpdateBlock\",\"version\":9,\"payload\":{\"text\":\"owned\"}}]}")
# sync_push is SECURITY INVOKER, so the UPDATE matches no rows under the intruder's policies and
# the row is untouched. What must never happen is the text changing.
is "another account cannot edit the block" "A edits block one" \
   "$(curl -s "$API/rest/v1/blocks?select=text&id=eq.$BLK" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['text'])")"
is "and pulls none of the owner's ops" "0" \
   "$(curl -s -X POST "$API/rest/v1/rpc/sync_pull" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
      -d '{"device":"attacker","cursor_seq":0}' | python3 -c "import sys,json;print(len(json.load(sys.stdin)['ops']))")"
# migration 0018: a direct insert into the log, aimed at the owner's space, must be refused
FORGE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/rest/v1/sync_ops" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
  -d "{\"device_id\":\"attacker\",\"entity\":\"block\",\"entity_id\":\"$BLK\",\"workspace_id\":\"$WS\",\"type\":\"UpdateBlock\",\"version\":99,\"payload\":{\"text\":\"owned\"}}")
is "and cannot forge an op into the owner's sync log" "403" "$FORGE"

# ---------------------------------------------------------------------------
# Migration 0003. Both cases below were livelocks before it: an id the server refused, or any single
# operation that raised, aborted the WHOLE sync_push call — so all 25 operations in the batch came
# back unacknowledged and were sent again, forever, and the only symptom was an outbox that never
# emptied.
echo "a readable client id is a legitimate id"
# Readable and NON-uuid, which is the whole point — but suffixed per run, because these
# ids are primary keys shared with every other account in this database and a fixed one
# would collide with the row the previous run left behind.
SEEDNOTE="note-groceries-$RUN"; SEEDBLK="blk-g1-$RUN"
OUT=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[
  {\"id\":\"s1\",\"entity\":\"note\",\"entityId\":\"$SEEDNOTE\",\"type\":\"CreateNote\",\"version\":1,\"payload\":{\"workspace_id\":\"$WS\",\"title\":\"Groceries\",\"type\":\"archive\"}},
  {\"id\":\"s2\",\"entity\":\"block\",\"entityId\":\"$SEEDBLK\",\"type\":\"CreateBlock\",\"version\":1,\"payload\":{\"note_id\":\"$SEEDNOTE\",\"type\":\"task\",\"text\":\"Oat milk\",\"position\":1}}]}")
is "the seeded library syncs" "ack ack" \
   "$(echo "$OUT" | python3 -c "import sys,json;print(' '.join(o['status'] for o in json.load(sys.stdin)))")"

echo "one impossible operation does not take the batch down with it"
# A block whose note does not exist. Worth knowing which error this actually is: RLS refuses the row
# (42501) before the foreign key is ever consulted, because `blocks_rw`'s WITH CHECK walks up to a
# note that isn't there. Either way it used to raise out of the function — its two innocent
# neighbours are what this is really asserting about.
OUT=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[
  {\"id\":\"m1\",\"entity\":\"block\",\"entityId\":\"$BLK\",\"type\":\"UpdateBlock\",\"version\":5,\"payload\":{\"text\":\"before the bad one\"}},
  {\"id\":\"m2\",\"entity\":\"block\",\"entityId\":\"orphan-block\",\"type\":\"CreateBlock\",\"version\":1,\"payload\":{\"note_id\":\"no-such-note\",\"type\":\"task\",\"text\":\"nowhere to live\"}},
  {\"id\":\"m3\",\"entity\":\"block\",\"entityId\":\"$SEEDBLK\",\"type\":\"UpdateBlock\",\"version\":2,\"payload\":{\"text\":\"after the bad one\"}}]}")
is "the batch still answers all three" "ack rejected ack" \
   "$(echo "$OUT" | python3 -c "import sys,json;print(' '.join(o['status'] for o in json.load(sys.stdin)))")"
is "the rejection names the table" "True" \
   "$(echo "$OUT" | python3 -c "import sys,json;print('blocks' in (json.load(sys.stdin)[1].get('reason') or ''))")"
is "the operation after it landed" "after the bad one" \
   "$(curl -s "$API/rest/v1/blocks?select=text&id=eq.$SEEDBLK" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['text'])")"
is "and the rejected row was not created" "0" \
   "$(curl -s "$API/rest/v1/blocks?select=id&id=eq.orphan-block" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"

# ---------------------------------------------------------------------------
# migration 0020: limits checked before the shared lock
echo "a push too big for the shared lock is refused before taking it"
msg () { python3 -c "import sys,json;print(json.load(sys.stdin).get('message'))"; }
MANY=$(python3 -c "import json;print(json.dumps({'device':'browser-a','ops':[{'id':str(i),'entity':'block','entityId':'none','type':'UpdateBlock','version':1,'payload':{}} for i in range(501)]}))")
MANY_OUT=$(rpc sync_push "$MANY")
is "501 ops in one push are refused" "too many ops in one push (max 500)" "$(echo "$MANY_OUT" | msg)"
# piped, not passed with -d: 5 MB is over the shell's argument limit
HUGE_OUT=$(python3 -c "import json;print(json.dumps({'device':'browser-a','ops':[{'id':'h','entity':'block','entityId':'none','type':'UpdateBlock','version':1,'payload':{'text':'x'*5300000}}]}))" \
  | curl -s -X POST "$API/rest/v1/rpc/sync_push" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H "$J" --data-binary @-)
is "a push over 5 MB is refused" "push too large (max 5 MB)" "$(echo "$HUGE_OUT" | msg)"
BRICK=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"v1\",\"entity\":\"block\",\"entityId\":\"$SEEDBLK\",\"type\":\"UpdateBlock\",\"version\":2147483647,\"payload\":{\"text\":\"bricked\"}}]}")
is "a version near the integer limit is refused" "version out of range" "$(echo "$BRICK" | msg)"
OUT=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"v2\",\"entity\":\"block\",\"entityId\":\"$SEEDBLK\",\"type\":\"UpdateBlock\",\"version\":3,\"payload\":{\"text\":\"after the limits\"}}]}")
is "a normal push still lands after them" "ack" "$(echo "$OUT" | status 0)"

# ---------------------------------------------------------------------------
# The rule that makes signing in on a SECOND browser survivable. Both devices backfill their local
# library (src/core/sync/backfill.ts), so device B sends a Create for every row device A already
# sent. Read as a version clash that is hundreds of conflicts about differences that do not exist.
echo "a Create the server already has is agreement, not a clash"
OUT=$(rpc sync_push "{\"device\":\"browser-b\",\"ops\":[{\"id\":\"dup1\",\"entity\":\"note\",\"entityId\":\"$SEEDNOTE\",\"type\":\"CreateNote\",\"version\":1,\"payload\":{\"workspace_id\":\"$WS\",\"title\":\"Groceries\",\"type\":\"archive\"}}]}")
is "B's duplicate create acks" "ack" "$(echo "$OUT" | status 0)"

# …and acking must not mean APPLYING. B's copy is stale — it was made before A's edit — so letting
# it through the update branch would roll the server back to an older title.
rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"a5\",\"entity\":\"note\",\"entityId\":\"$SEEDNOTE\",\"type\":\"UpdateNote\",\"version\":2,\"payload\":{\"title\":\"Groceries (renamed by A)\"}}]}" > /dev/null
OUT=$(rpc sync_push "{\"device\":\"browser-b\",\"ops\":[{\"id\":\"dup2\",\"entity\":\"note\",\"entityId\":\"$SEEDNOTE\",\"type\":\"CreateNote\",\"version\":1,\"payload\":{\"workspace_id\":\"$WS\",\"title\":\"Groceries\",\"type\":\"archive\"}}]}")
is "a stale create still acks" "ack" "$(echo "$OUT" | status 0)"
is "and does NOT roll the row back" "Groceries (renamed by A)" \
   "$(curl -s "$API/rest/v1/notes?select=title&id=eq.$SEEDNOTE" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['title'])")"

# ---------------------------------------------------------------------------
# Migration 0005. Access is a workspace_members row now, not workspaces.owner_id.
#
# The account in $TOK2 is the same one that failed to reach anything above — which is the point of
# reusing it: nothing about that account changed, only its membership. If these pass while the
# refusals above still pass, the swap widened access by exactly one row and nothing else.
#
# Since 0019 the only way in is share_workspace + respond_to_invitation; direct table writes are refused.
echo "membership is what grants access, not ownership"

U2=$(curl -s "$API/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

# usage: name_of TOKEN USER_ID — reads the account's own profile name
name_of () { curl -s "$API/rest/v1/profiles?select=display_name&user_id=eq.$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" </dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['display_name'])"; }
# usage: invite_and_accept INVITEE_TOKEN INVITEE_ID ROLE — A shares $WS, the invitee says yes
invite_and_accept () {
  local name body
  name=$(name_of "$1" "$2")
  body=$(python3 -c "import json,sys;print(json.dumps({'ws':sys.argv[1],'member_name':sys.argv[2],'member_role':sys.argv[3]}))" "$WS" "$name" "$3")
  curl -s -X POST "$API/rest/v1/rpc/share_workspace" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H "$J" -d "$body" </dev/null > /dev/null
  curl -s -X POST "$API/rest/v1/rpc/respond_to_invitation" -H "apikey: $ANON" -H "Authorization: Bearer $1" -H "$J" \
    -d "{\"ws\":\"$WS\",\"accept\":true}" </dev/null | python3 -c "import sys,json;print(json.load(sys.stdin))"
}
# usage: remove_as_admin USER_ID
remove_as_admin () { curl -s -X POST "$API/rest/v1/rpc/remove_member" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H "$J" \
  -d "{\"ws\":\"$WS\",\"target\":\"$1\"}" </dev/null | python3 -c "import sys,json;print(json.load(sys.stdin))"; }

is "the creator was made an admin by the trigger" "1" \
   "$(curl -s "$API/rest/v1/workspace_members?select=role&workspace_id=eq.$WS&role=eq.admin" \
        -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"

ADD=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/rest/v1/workspace_members" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H "$J" \
  -d "{\"workspace_id\":\"$WS\",\"user_id\":\"$U2\",\"role\":\"member\",\"membership\":\"active\"}")
is "an admin cannot add somebody directly, skipping the invite" "403" "$ADD"

is "an admin can invite somebody and they accept" "accepted" "$(invite_and_accept "$TOK2" "$U2" member)"

is "and now they can read the owner's page" "Kernel Labs" \
   "$(curl -s "$API/rest/v1/notes?select=title&id=eq.$NOTE" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" \
      | python3 -c "import sys,json;r=json.load(sys.stdin);print(r[0]['title'] if r else 'NOTHING')")"

# A block of its own rather than one of the two above: those have been through every conflict
# scenario in this file and are at whatever version those left behind, so a hardcoded base version
# here would assert about accumulated state instead of about membership.
BLK3=$(uuid)
rpc sync_push "{\"device\":\"browser-a\",\"ops\":[
  {\"id\":\"g1\",\"entity\":\"block\",\"entityId\":\"$BLK3\",\"type\":\"CreateBlock\",\"version\":1,\"payload\":{\"note_id\":\"$NOTE\",\"type\":\"task\",\"text\":\"Draft the invite copy\",\"position\":3}}]}" > /dev/null
# Captured into a variable and echoed into `status`, rather than piped straight from curl inside the
# argument to `is`. Nesting a curl inside that command substitution let it eat the script's stdin,
# and the assertion read an empty body while the request itself had succeeded — a failure that
# accused the database of something the test was doing.
MEMBER_PUSH=$(curl -s -X POST "$API/rest/v1/rpc/sync_push" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
      -d "{\"device\":\"maya-laptop\",\"ops\":[{\"id\":\"n1\",\"entity\":\"block\",\"entityId\":\"$BLK3\",\"type\":\"UpdateBlock\",\"version\":2,\"payload\":{\"text\":\"Draft the invite copy (Maya)\"}}]}" </dev/null)
is "and edit a block in it — a member writes inside pages" "ack" "$(echo "$MEMBER_PUSH" | status 0)"

is "and the member's text is what the page now says" "Draft the invite copy (Maya)" \
   "$(curl -s "$API/rest/v1/blocks?select=text&id=eq.$BLK3" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" \
      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['text'])")"

# The member list is the assignee picker's source (design/collaboration-and-sharing.md §7), so a
# member has to be able to see who else is here — not just that they themselves are.
is "a member sees the whole member list, not only their own row" "2" \
   "$(curl -s "$API/rest/v1/workspace_members?select=user_id&workspace_id=eq.$WS" \
        -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"

# Over-tightening is as bad as leaving it open, so both halves are asserted: a member gains the
# space, and gains nothing beyond it.
OUTSIDE=$(uuid)
curl -s -X POST "$API/rest/v1/rpc/sync_push" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H "$J" \
  -d "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"p1\",\"entity\":\"workspace\",\"entityId\":\"$OUTSIDE\",\"type\":\"CreateWorkspace\",\"version\":1,\"payload\":{\"name\":\"Private\"}}]}" > /dev/null
is "membership does not leak into the inviter's OTHER spaces" "0" \
   "$(curl -s "$API/rest/v1/workspaces?select=id&id=eq.$OUTSIDE" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"

# Revocation is a flip, not a delete — the row stays so re-granting restores prior state (§4.4).
is "remove_member removes them" "removed" "$(remove_as_admin "$U2")"
is "a removed member loses the space again" "0" \
   "$(curl -s "$API/rest/v1/notes?select=title&id=eq.$NOTE" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"

is "an admin cannot re-activate them directly" "0" \
   "$(curl -s -X PATCH "$API/rest/v1/workspace_members?workspace_id=eq.$WS&user_id=eq.$U2" \
        -H "apikey: $ANON" -H "Authorization: Bearer $TOK" -H "$J" -H "Prefer: return=representation" \
        -d '{"membership":"active"}' | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"

is "re-invite and accept brings them back" "accepted" "$(invite_and_accept "$TOK2" "$U2" member)"
is "and gets it back on re-grant, without a new membership" "Kernel Labs" \
   "$(curl -s "$API/rest/v1/notes?select=title&id=eq.$NOTE" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" \
      | python3 -c "import sys,json;r=json.load(sys.stdin);print(r[0]['title'] if r else 'NOTHING')")"

U1=$(curl -s "$API/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" </dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
is "the last admin cannot be removed" "last_admin" "$(remove_as_admin "$U1")"
RM_BODY="{\"ws\":\"$WS\",\"target\":\"$U1\"}"
RM_OUT=$(curl -s -X POST "$API/rest/v1/rpc/remove_member" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
  -d "$RM_BODY" </dev/null | python3 -c "import sys,json;print(json.load(sys.stdin))")
is "a member cannot remove anyone" "not_admin" "$RM_OUT"

is "a member cannot promote themselves to admin" "0" \
   "$(curl -s -X PATCH "$API/rest/v1/workspace_members?workspace_id=eq.$WS&user_id=eq.$U2" \
        -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" -H "Prefer: return=representation" \
        -d '{"role":"admin"}' | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"

# ---------------------------------------------------------------------------
# Migration 0006. This was the KNOWN GAP 0005 left asserted at 0: a member could read the space and
# write to it, and never receive a single one of the other person's operations. The failure mode is
# what makes it the highest-risk item in the plan (§4.3) — sharing LOOKS like it works, so nobody
# comes back here.
echo "a member receives the other person's operations"

M_PULL=$(curl -s -X POST "$API/rest/v1/rpc/sync_pull" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
  -d '{"device":"maya-laptop","cursor_seq":0}' </dev/null)
M_OPS=$(echo "$M_PULL" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['ops']))")
[ "$M_OPS" -gt 0 ] && ok "the admin's operations now arrive ($M_OPS of them)" \
                   || bad "the admin's operations now arrive" "more than 0" "$M_OPS"

is "including the page itself, so it can be rendered at all" "1" \
   "$(echo "$M_PULL" | python3 -c "import sys,json;print(sum(1 for o in json.load(sys.stdin)['ops'] if o['entityId']=='$NOTE'))")"

# The other half, and the one that would leak: arriving in a space must not mean arriving in the
# inviter's whole account. $OUTSIDE is the private workspace created above.
is "and NOTHING from the inviter's other spaces" "0" \
   "$(echo "$M_PULL" | python3 -c "import sys,json;print(sum(1 for o in json.load(sys.stdin)['ops'] if o['entityId']=='$OUTSIDE'))")"

# A stranger is still a stranger — the assertion 0005 relied on, re-checked now that the predicate
# it depended on has been replaced. A THIRD account, because $TOK2 is a member now: the account that
# used to prove strangers see nothing has been let in, and reusing it would prove nothing.
STRANGER="{\"email\":\"stranger-$RUN@example.com\",\"password\":\"password123\"}"
curl -s -X POST "$API/auth/v1/signup" -H "apikey: $ANON" -H "$J" -d "$STRANGER" </dev/null > /dev/null
TOK3=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "$J" -d "$STRANGER" </dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
is "a non-member still pulls nothing at all" "0" \
   "$(curl -s -X POST "$API/rest/v1/rpc/sync_pull" -H "apikey: $ANON" -H "Authorization: Bearer $TOK3" -H "$J" \
      -d '{"device":"nobody","cursor_seq":0}' </dev/null \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)['ops']))")"

# The rule that survived the rewrite: a device never receives its own operations back. Maya's own
# edit to $BLK3 must not come back to the device that made it.
is "a device still does not receive its own operations back" "0" \
   "$(echo "$M_PULL" | python3 -c "import sys,json;print(sum(1 for o in json.load(sys.stdin)['ops'] if o['entityId']=='$BLK3' and 'Maya' in json.dumps(o.get('payload') or {})))")"

# ...but the SAME account on a DIFFERENT device must. This is the case the old `device_id <> device`
# form conflated with the one above.
is "though a second device of the same account does" "1" \
   "$(curl -s -X POST "$API/rest/v1/rpc/sync_pull" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
      -d '{"device":"maya-phone","cursor_seq":0}' </dev/null \
      | python3 -c "import sys,json;print(sum(1 for o in json.load(sys.stdin)['ops'] if o['entityId']=='$BLK3' and 'Maya' in json.dumps(o.get('payload') or {})))")"

# Revocation has to stop the flow, not just hide the pages — an ex-member who kept pulling would
# keep receiving the space's contents forever.
remove_as_admin "$U2" > /dev/null
is "a removed member stops receiving operations" "0" \
   "$(curl -s -X POST "$API/rest/v1/rpc/sync_pull" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
      -d '{"device":"maya-laptop","cursor_seq":0}' </dev/null \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)['ops']))")"

invite_and_accept "$TOK2" "$U2" member > /dev/null
RG_OPS=$(curl -s -X POST "$API/rest/v1/rpc/sync_pull" -H "apikey: $ANON" -H "Authorization: Bearer $TOK2" -H "$J" \
      -d '{"device":"maya-laptop","cursor_seq":0}' </dev/null \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)['ops']))")
[ "$RG_OPS" -gt 0 ] && ok "and receives them again after a re-grant" \
                    || bad "and receives them again after a re-grant" "more than 0" "$RG_OPS"

# ---------------------------------------------------------------------------
# Migration 0011: guest reads, member writes inside pages, only an admin deletes a page or renames the space.
echo "roles decide who may write, not just who may read"

rpc_as () { curl -s -X POST "$API/rest/v1/rpc/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" -H "$J" -d "$3" </dev/null; }
text_of () { curl -s "$API/rest/v1/blocks?select=text&id=eq.$1" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" </dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['text'])"; }

GUEST="{\"email\":\"guest-$RUN@example.com\",\"password\":\"password123\"}"
curl -s -X POST "$API/auth/v1/signup" -H "apikey: $ANON" -H "$J" -d "$GUEST" </dev/null > /dev/null
TOK4=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "$J" -d "$GUEST" </dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
U4=$(curl -s "$API/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $TOK4" </dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
invite_and_accept "$TOK4" "$U4" guest > /dev/null

is "a guest can read the page" "Kernel Labs" \
   "$(curl -s "$API/rest/v1/notes?select=title&id=eq.$NOTE" -H "apikey: $ANON" -H "Authorization: Bearer $TOK4" </dev/null \
      | python3 -c "import sys,json;r=json.load(sys.stdin);print(r[0]['title'] if r else 'NOTHING')")"

OUT=$(rpc_as "$TOK4" sync_push "{\"device\":\"guest-laptop\",\"ops\":[{\"id\":\"q1\",\"entity\":\"block\",\"entityId\":\"$BLK3\",\"type\":\"UpdateBlock\",\"version\":3,\"payload\":{\"text\":\"Guest was here\"}}]}")
is "a guest's edit is rejected, not acked" "rejected" "$(echo "$OUT" | status 0)"
is "and the block keeps the member's text" "Draft the invite copy (Maya)" "$(text_of "$BLK3")"

# RLS filters an UPDATE to 0 rows without raising; unchecked, the op would be logged and shipped to everyone.
is "and the refused edit never reaches anyone's pull" "0" \
   "$(rpc_as "$TOK" sync_pull '{"device":"browser-a","cursor_seq":0}' \
      | python3 -c "import sys,json;print(sum(1 for o in json.load(sys.stdin)['ops'] if 'Guest was here' in json.dumps(o.get('payload') or {})))")"

GBLK=$(uuid)
OUT=$(rpc_as "$TOK4" sync_push "{\"device\":\"guest-laptop\",\"ops\":[{\"id\":\"q2\",\"entity\":\"block\",\"entityId\":\"$GBLK\",\"type\":\"CreateBlock\",\"version\":1,\"payload\":{\"note_id\":\"$NOTE\",\"type\":\"task\",\"text\":\"Guest task\",\"position\":9}}]}")
is "a guest cannot add a block" "rejected" "$(echo "$OUT" | status 0)"

is "nor edit one directly through the REST API" "0" \
   "$(curl -s -X PATCH "$API/rest/v1/blocks?id=eq.$BLK3" -H "apikey: $ANON" -H "Authorization: Bearer $TOK4" -H "$J" \
        -H "Prefer: return=representation" -d '{"text":"Guest via REST"}' </dev/null \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")"

OUT=$(rpc_as "$TOK2" sync_push "{\"device\":\"maya-laptop\",\"ops\":[{\"id\":\"n2\",\"entity\":\"block\",\"entityId\":\"$BLK3\",\"type\":\"DeleteBlock\",\"version\":3,\"payload\":{}}]}")
is "a member can still delete a task" "ack" "$(echo "$OUT" | status 0)"

NOTE2=$(uuid)
rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"r1\",\"entity\":\"note\",\"entityId\":\"$NOTE2\",\"type\":\"CreateNote\",\"version\":1,\"payload\":{\"workspace_id\":\"$WS\",\"title\":\"Roadmap\",\"type\":\"single\"}}]}" </dev/null > /dev/null
OUT=$(rpc_as "$TOK2" sync_push "{\"device\":\"maya-laptop\",\"ops\":[{\"id\":\"n3\",\"entity\":\"note\",\"entityId\":\"$NOTE2\",\"type\":\"DeleteNote\",\"version\":2,\"payload\":{}}]}")
is "a member cannot delete a page" "rejected" "$(echo "$OUT" | status 0)"
is "and is told why" "True" \
   "$(echo "$OUT" | python3 -c "import sys,json;print('admin' in (json.load(sys.stdin)[0].get('reason') or ''))")"
is "the page is still there" "None" \
   "$(curl -s "$API/rest/v1/notes?select=deleted_at&id=eq.$NOTE2" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" </dev/null \
      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['deleted_at'])")"

OUT=$(rpc_as "$TOK2" sync_push "{\"device\":\"maya-laptop\",\"ops\":[{\"id\":\"n4\",\"entity\":\"note\",\"entityId\":\"$NOTE2\",\"type\":\"UpdateNote\",\"version\":2,\"payload\":{\"title\":\"Roadmap (Maya)\"}}]}")
is "though a member can still rename it" "ack" "$(echo "$OUT" | status 0)"

OUT=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"r2\",\"entity\":\"note\",\"entityId\":\"$NOTE2\",\"type\":\"DeleteNote\",\"version\":3,\"payload\":{}}]}")
is "an admin can delete a page" "ack" "$(echo "$OUT" | status 0)"

OUT=$(rpc_as "$TOK2" sync_push "{\"device\":\"maya-laptop\",\"ops\":[{\"id\":\"n5\",\"entity\":\"workspace\",\"entityId\":\"$WS\",\"type\":\"UpdateWorkspace\",\"version\":2,\"payload\":{\"name\":\"Renamed by Maya\"}}]}")
is "a member's rename of the space is rejected, not acked" "rejected" "$(echo "$OUT" | status 0)"
is "and the space keeps its name" "Personal" \
   "$(curl -s "$API/rest/v1/workspaces?select=name&id=eq.$WS" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" </dev/null \
      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['name'])")"

# ---------------------------------------------------------------------------
# Migration 0013: $OUTSIDE is A's private space; $WS has Maya (member) and a guest in it.
echo "a page moves out of a space you are alone in, and arrives whole"

ws_of () { curl -s "$API/rest/v1/notes?select=workspace_id&id=eq.$1" -H "apikey: $ANON" -H "Authorization: Bearer $2" </dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['workspace_id'])"; }
count_ops () { python3 -c "import sys,json;print(sum(1 for o in json.load(sys.stdin)['ops'] if $1))"; }

MV=$(uuid); MVB1=$(uuid); MVB2=$(uuid)
rpc sync_push "{\"device\":\"browser-a\",\"ops\":[
  {\"id\":\"m1\",\"entity\":\"note\",\"entityId\":\"$MV\",\"type\":\"CreateNote\",\"version\":1,\"payload\":{\"workspace_id\":\"$OUTSIDE\",\"title\":\"Sprint plan\",\"type\":\"single\"}},
  {\"id\":\"m2\",\"entity\":\"block\",\"entityId\":\"$MVB1\",\"type\":\"CreateBlock\",\"version\":1,\"payload\":{\"note_id\":\"$MV\",\"type\":\"task\",\"text\":\"Private first draft\",\"position\":1}}]}" </dev/null > /dev/null
rpc sync_push "{\"device\":\"browser-a\",\"ops\":[
  {\"id\":\"m3\",\"entity\":\"block\",\"entityId\":\"$MVB1\",\"type\":\"UpdateBlock\",\"version\":2,\"payload\":{\"text\":\"Book the venue\"}},
  {\"id\":\"m4\",\"entity\":\"block\",\"entityId\":\"$MVB2\",\"type\":\"CreateBlock\",\"version\":1,\"payload\":{\"note_id\":\"$MV\",\"type\":\"task\",\"text\":\"Send the invites\",\"position\":2}}]}" </dev/null > /dev/null

OUT=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"m5\",\"entity\":\"note\",\"entityId\":\"$MV\",\"type\":\"UpdateNote\",\"version\":2,\"payload\":{\"workspace_id\":\"$WS\",\"title\":\"Sprint plan\"}}]}" </dev/null)
is "moving a page out of a private space is acked" "ack" "$(echo "$OUT" | status 0)"
is "and the page now lives in the project" "$WS" "$(ws_of "$MV" "$TOK")"

MV_PULL=$(rpc_as "$TOK2" sync_pull '{"device":"maya-laptop","cursor_seq":0}')
is "the project's member receives the page as a Create" "1" \
   "$(echo "$MV_PULL" | count_ops "o['entityId']=='$MV' and o['type']=='CreateNote'")"
is "and every block in it" "2" \
   "$(echo "$MV_PULL" | count_ops "o['entityId'] in ('$MVB1','$MVB2') and o['type']=='CreateBlock'")"
is "with the blocks as they are now" "1" \
   "$(echo "$MV_PULL" | count_ops "o['entityId']=='$MVB1' and (o.get('payload') or {}).get('text')=='Book the venue'")"
is "and none of the page's private history" "0" \
   "$(echo "$MV_PULL" | count_ops "'Private first draft' in json.dumps(o.get('payload') or {})")"
is "the device that moved it is not sent its own re-announcement" "0" \
   "$(rpc sync_pull '{"device":"browser-a","cursor_seq":0}' | count_ops "o['entityId']=='$MV'")"

OUT=$(rpc_as "$TOK2" sync_push "{\"device\":\"maya-laptop\",\"ops\":[{\"id\":\"m6\",\"entity\":\"note\",\"entityId\":\"$MV\",\"type\":\"UpdateNote\",\"version\":3,\"payload\":{\"workspace_id\":\"$WS\",\"title\":\"Sprint plan (Maya)\"}}]}")
is "an update naming the page's own space is not a move" "ack" "$(echo "$OUT" | status 0)"

NOTE_V=$(curl -s "$API/rest/v1/notes?select=version&id=eq.$NOTE" -H "apikey: $ANON" -H "Authorization: Bearer $TOK" </dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['version'])")
OUT=$(rpc sync_push "{\"device\":\"browser-a\",\"ops\":[{\"id\":\"m7\",\"entity\":\"note\",\"entityId\":\"$NOTE\",\"type\":\"UpdateNote\",\"version\":$((NOTE_V+1)),\"payload\":{\"workspace_id\":\"$OUTSIDE\"}}]}" </dev/null)
is "a page cannot leave a space other people are in" "rejected" "$(echo "$OUT" | status 0)"
is "and is told why" "True" \
   "$(echo "$OUT" | python3 -c "import sys,json;print('nobody else' in (json.load(sys.stdin)[0].get('reason') or ''))")"
is "and stays where it was" "$WS" "$(ws_of "$NOTE" "$TOK")"

GWS=$(uuid); GN=$(uuid)
rpc_as "$TOK4" sync_push "{\"device\":\"guest-laptop\",\"ops\":[
  {\"id\":\"g1\",\"entity\":\"workspace\",\"entityId\":\"$GWS\",\"type\":\"CreateWorkspace\",\"version\":1,\"payload\":{\"name\":\"Personal\"}},
  {\"id\":\"g2\",\"entity\":\"note\",\"entityId\":\"$GN\",\"type\":\"CreateNote\",\"version\":1,\"payload\":{\"workspace_id\":\"$GWS\",\"title\":\"Guest notes\",\"type\":\"single\"}}]}" > /dev/null
OUT=$(rpc_as "$TOK4" sync_push "{\"device\":\"guest-laptop\",\"ops\":[{\"id\":\"g3\",\"entity\":\"note\",\"entityId\":\"$GN\",\"type\":\"UpdateNote\",\"version\":2,\"payload\":{\"workspace_id\":\"$WS\"}}]}")
is "a guest cannot move a page into a project they only read" "rejected" "$(echo "$OUT" | status 0)"
is "and it stays in their own space" "$GWS" "$(ws_of "$GN" "$TOK4")"

echo ""
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
