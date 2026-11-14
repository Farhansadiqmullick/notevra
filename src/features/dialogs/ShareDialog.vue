<script setup lang="ts">
/**
 * ShareDialog — who can open this PROJECT, and how to add somebody.
 *
 * It shares the workspace, not the page, and says so in the header: sharing is per-project
 * (design/collaboration-and-sharing.md §6.1), and a Share button that quietly shared five other
 * pages would be the worst possible reading of the word.
 *
 * An admin gets the input and the remove buttons; everyone else gets the roster, which is still the
 * answer to "who can see this?". See design/display-names-and-sharing.md.
 */
import { computed, ref, onMounted, watch } from 'vue';
import {
  useWorkspaceMembers,
  looksLikeEmail,
  MIN_SEARCH,
  type ShareOutcome,
  type EmailInviteOutcome,
  type PendingInvite,
} from '@/composables/useWorkspaceMembers';
import BaseAvatar from '@/components/primitives/BaseAvatar.vue';
import BaseButton from '@/components/primitives/BaseButton.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = defineProps<{ workspaceId: string; workspaceName: string }>();
const emit = defineEmits<{ close: [] }>();

const { members, pending, loading, myRole, search, share, inviteByEmail, cancelInvite, remove, leave } =
  useWorkspaceMembers(computed(() => props.workspaceId));

const ROLES = [
  { id: 'member', label: 'Member', hint: 'Can read and write everything in the project' },
  { id: 'guest', label: 'Guest', hint: 'Meant to be read-only — not enforced yet' },
  { id: 'admin', label: 'Admin', hint: 'Full control, including sharing' },
] as const;

const name = ref('');
const role = ref<string>('member');
const busy = ref(false);
const message = ref('');
const failed = ref(false);
const nameField = ref<HTMLInputElement | null>(null);

const isAdmin = computed(() => myRole.value === 'admin');
const isEmail = computed(() => looksLikeEmail(name.value));
const removing = ref<string | null>(null);

/** search results under the input; a click picks the exact name rather than sharing on the spot */
const hits = ref<Array<{ id: string; name: string; already: boolean }>>([]);
const searching = ref(false);
const picked = ref('');
let hitTimer: ReturnType<typeof setTimeout> | undefined;

watch(name, (raw) => {
  const term = raw.trim();
  clearTimeout(hitTimer);
  if (term === picked.value) return; // they chose this from the list; don't reopen it
  picked.value = '';
  if (!isAdmin.value || term.length < MIN_SEARCH || term.includes('@')) {
    hits.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  hitTimer = setTimeout(async () => {
    const found = await search(term);
    if (name.value.trim() !== term) return; // a later keystroke owns the box now
    hits.value = found;
    searching.value = false;
  }, 250);
});

function choose(hit: { name: string; already: boolean }) {
  if (hit.already) return;
  picked.value = hit.name;
  name.value = hit.name;
  hits.value = [];
}

const SAID: Record<ShareOutcome, string> = {
  ok: '',
  not_found: 'No one found with that name.',
  already_member: 'They are already in this project.',
  already_invited: 'They have already been invited — it is waiting for their answer.',
  not_admin: 'Only an admin of this project can share it.',
  bad_role: 'That is not a role.',
  failed: 'Could not reach the server. Try again when you are back online.',
};

const EMAIL_SAID: Record<EmailInviteOutcome, string> = {
  sent: '',
  invited: '',
  already_member: 'They are already in this project.',
  already_invited: 'They have already been invited. It is waiting for their answer.',
  bad_email: 'That does not look like an email address.',
  not_admin: 'Only an admin of this project can share it.',
  rate_limited: 'Too many invitations in the last hour. Try again later.',
  bad_role: 'That is not a role.',
  failed: 'Could not send the invitation. Try again when you are back online.',
};

const LEAVE_SAID: Record<string, string> = {
  left: 'You have left this project.',
  last_admin: 'You are the only admin. Make someone else an admin first.',
  not_a_member: 'You are not in this project.',
  failed: 'Could not reach the server.',
};

const leaving = ref(false);
async function doLeave() {
  if (!leaving.value) return (leaving.value = true);
  leaving.value = false;
  const outcome = await leave();
  failed.value = outcome !== 'left';
  message.value = LEAVE_SAID[outcome] ?? 'Could not leave.';
  if (outcome === 'left') emit('close');
}

onMounted(() => nameField.value?.focus());

async function submit() {
  const wanted = name.value.trim();
  if (!wanted || busy.value) return;
  busy.value = true;
  message.value = '';
  if (isEmail.value) {
    const sent = await inviteByEmail(wanted, role.value);
    busy.value = false;
    const ok = sent === 'sent' || sent === 'invited';
    failed.value = !ok;
    message.value =
      sent === 'sent'
        ? `Invitation emailed to ${wanted}. It expires in 14 days.`
        : sent === 'invited'
          ? `Invited ${wanted}. They will see it in Notevra and get access once they accept.`
          : EMAIL_SAID[sent];
    if (ok) name.value = '';
    return;
  }
  const outcome = await share(wanted, role.value);
  busy.value = false;
  failed.value = outcome !== 'ok';
  if (outcome === 'ok') {
    message.value = `Invited ${wanted}. They get access once they accept.`;
    picked.value = '';
    name.value = '';
    hits.value = [];
  } else {
    message.value = SAID[outcome];
  }
}

const cancelling = ref<string | null>(null);
async function cancel(p: PendingInvite) {
  if (cancelling.value !== p.key) return (cancelling.value = p.key);
  cancelling.value = null;
  const ok = await cancelInvite(p);
  failed.value = !ok;
  message.value = ok ? `Invitation to ${p.label} cancelled.` : 'Could not cancel the invitation.';
}

async function drop(id: string, who: string) {
  if (removing.value !== id) return (removing.value = id);
  removing.value = null;
  failed.value = !(await remove(id));
  message.value = failed.value ? 'Could not remove them.' : `${who} no longer has access.`;
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Share project">
      <header class="head">
        <div>
          <h2>Share {{ workspaceName }}</h2>
          <p>Everyone here can open every page in this project — sharing is per project, not per page.</p>
        </div>
        <button class="x" aria-label="Close" @click="emit('close')"><AppIcon name="close" /></button>
      </header>

      <div v-if="isAdmin" class="add">
        <div class="row">
          <div class="findwrap">
            <input
              ref="nameField"
              v-model="name"
              class="who"
              type="text"
              placeholder="Name or email…"
              autocomplete="off"
              :disabled="busy"
              @keydown.enter.prevent="submit"
              @keydown.esc.stop="hits = []"
            />
            <div v-if="hits.length || searching" class="hits">
              <p v-if="searching" class="hitnote">Searching…</p>
              <button
                v-for="h in hits"
                :key="h.id"
                type="button"
                class="hit"
                :class="{ dim: h.already }"
                :disabled="h.already"
                @click="choose(h)"
              >
                <BaseAvatar :initials="h.name.slice(0, 2).toUpperCase()" :size="30" />
                <span class="hitname">{{ h.name }}</span>
                <span v-if="h.already" class="hitmeta">already in</span>
              </button>
            </div>
          </div>
          <select v-model="role" class="role" :disabled="busy">
            <option v-for="r in ROLES" :key="r.id" :value="r.id">{{ r.label }}</option>
          </select>
          <BaseButton size="sm" :disabled="busy || !name.trim()" @click="submit">{{ isEmail ? 'Invite' : 'Share' }}</BaseButton>
        </div>
        <p class="hint">{{ ROLES.find((r) => r.id === role)?.hint }}</p>
        <p class="hint">Search a name ({{ MIN_SEARCH }}+ letters), or type an email. No account yet? They get an email to sign up.</p>
      </div>

      <p v-if="message" class="said" :class="{ bad: failed }">{{ message }}</p>

      <div class="list">
        <p v-if="loading" class="empty">Looking…</p>
        <p v-else-if="!members.length" class="empty">
          No one here yet. Sign in, or check you are online — the member list is read from the server.
        </p>
        <div v-for="m in members" :key="m.id" class="person">
          <BaseAvatar :initials="m.initials" :size="26" />
          <div class="who-col">
            <span class="nm">{{ m.name }}<span v-if="m.isMe" class="you"> · you</span></span>
            <span class="rl">{{ m.role }}</span>
          </div>
          <template v-if="isAdmin && !m.isMe">
            <button v-if="removing !== m.id" class="act danger" @click="drop(m.id, m.name)">Remove</button>
            <template v-else>
              <button class="act" @click="removing = null">Cancel</button>
              <button class="act yes" @click="drop(m.id, m.name)">Remove</button>
            </template>
          </template>
        </div>

        <template v-if="isAdmin && pending.length">
          <p class="sect">Pending · {{ pending.length }}</p>
          <div v-for="p in pending" :key="p.key" class="person">
            <BaseAvatar :initials="p.label.slice(0, 2).toUpperCase()" :size="26" />
            <div class="who-col">
              <span class="nm">{{ p.label }}</span>
              <span class="rl">{{ p.role }} · {{ p.userId ? 'waiting for their answer' : 'waiting for sign-up' }}</span>
            </div>
            <button v-if="cancelling !== p.key" class="act" @click="cancel(p)">Cancel invite</button>
            <template v-else>
              <button class="act" @click="cancelling = null">Keep</button>
              <button class="act yes" @click="cancel(p)">Cancel invite</button>
            </template>
          </div>
        </template>
      </div>

      <footer v-if="myRole" class="foot">
        <span v-if="!isAdmin" class="footnote">Only an admin of this project can add or remove people.</span>
        <span v-else class="footnote" />
        <template v-if="!leaving">
          <button class="leavebtn" @click="doLeave">Leave project</button>
        </template>
        <template v-else>
          <span class="q">Leave {{ workspaceName }}?</span>
          <button class="act" @click="leaving = false">Cancel</button>
          <button class="act yes" @click="doLeave">Leave</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(520px, 100%); max-block-size: 82vh; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }
.head { display: flex; align-items: flex-start; gap: 12px; padding: 22px 24px 16px; border-bottom: 1px solid var(--border); }
.head h2 { font: 800 18px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 5px 0 0; }
.x { margin-inline-start: auto; border: none; background: none; cursor: pointer; font-size: 14px; color: var(--ink-faint); padding: 4px; }
.x:hover { color: var(--ink-body); }

.add { padding: 16px 20px 10px; border-bottom: 1px solid var(--border); }
.row { display: flex; align-items: center; gap: 8px; }
.findwrap { position: relative; flex: 1; min-inline-size: 0; }
.who { inline-size: 100%; border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 8px 10px; font: 500 13px var(--font-ui); color: var(--ink-body); background: var(--surface); }

/* the results list is deliberately roomy: 30px avatar, 12px gutters, 11px rows. A dense dropdown
   of names is hard to aim at, and this is the moment someone is scanning for a specific person. */
.hits { position: absolute; inset-block-start: calc(100% + 6px); inset-inline: 0; z-index: 10; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-modal, var(--sh-hairline)); padding: 6px; max-block-size: 264px; overflow-y: auto; }
.hit { display: flex; align-items: center; gap: 12px; inline-size: 100%; text-align: start; border: none; background: none; cursor: pointer; border-radius: var(--r-row); padding: 11px 12px; }
.hit:hover:not(:disabled) { background: var(--divider-faint); }
.hit.dim { cursor: default; opacity: 0.55; }
.hitname { flex: 1; min-inline-size: 0; font: 600 13px var(--font-ui); color: var(--ink-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hitmeta { font: 500 11px var(--font-ui); color: var(--ink-faint); white-space: nowrap; }
.hitnote { margin: 0; padding: 11px 12px; font: 500 12px var(--font-ui); color: var(--ink-faint); }
.who:focus { outline: none; border-color: var(--accent); }
.role { border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 8px; font: 600 12px var(--font-ui); color: var(--ink-muted); background: var(--surface); }
.hint { margin: 7px 0 0; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }

.said { margin: 0; padding: 11px 20px; font: 600 12px var(--font-ui); color: var(--accent-deep); background: var(--accent-tint); }
.said.bad { color: var(--danger); background: var(--danger-tint); }

.list { overflow-y: auto; padding: 10px; flex: 1; }
.empty { padding: 24px; text-align: center; font: 500 12.5px/1.6 var(--font-ui); color: var(--ink-faint); margin: 0; }
.person { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--r-item); }
.person:hover { background: var(--surface-subtle); }
.sect { margin: 12px 10px 4px; font: 700 10.5px var(--font-ui); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-faint); }
.who-col { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; }
.nm { font: 600 13px var(--font-ui); color: var(--ink-body); }
.you { font-weight: 500; color: var(--ink-faint); }
.rl { font: 500 10.5px var(--font-ui); color: var(--ink-faint); text-transform: capitalize; }
.act { border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; border-radius: var(--r-control); padding: 5px 10px; font: 600 11px var(--font-ui); color: var(--ink-muted); }
.act:hover { border-color: var(--border-hover); color: var(--ink-body); }
.act.danger { color: var(--danger); }
.act.yes { border: none; background: var(--danger); color: #fff; }
.foot { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--border); }
.footnote { flex: 1; min-inline-size: 0; font: 500 11.5px/1.5 var(--font-ui); color: var(--ink-faint); }
.leavebtn { border: none; background: none; cursor: pointer; font: 600 11.5px var(--font-ui); color: var(--danger); white-space: nowrap; }
.leavebtn:hover { text-decoration: underline; }
.q { font: 500 11.5px var(--font-ui); color: var(--ink-muted); white-space: nowrap; }
</style>
