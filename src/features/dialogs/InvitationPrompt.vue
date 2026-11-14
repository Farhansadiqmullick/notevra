<script setup lang="ts">
/**
 * InvitationPrompt — "Ada Admin invited you to Kernel Labs." Accept, or decline.
 *
 * Before this, sharing inserted an active membership and the project simply appeared in your
 * sidebar. This is the consent step design/collaboration-and-sharing.md §1 always specified.
 *
 * Dismissing is not declining. The invitation stays pending and the prompt returns next time —
 * "not now" is a real answer and it must not silently mean no.
 */
import { onMounted, watch } from 'vue';
import { useInvitations } from '@/composables/useInvitations';
import { useNotifications } from '@/composables/useNotifications';
import { useAuthStore } from '@/stores/auth.store';
import { useNoticeStore } from '@/stores/notice.store';
import { useSyncStore } from '@/stores/sync.store';
import BaseButton from '@/components/primitives/BaseButton.vue';

const auth = useAuthStore();
const notice = useNoticeStore();
const sync = useSyncStore();
const { invitations, answering, refresh, respond } = useInvitations();

const ROLE_SAYS: Record<string, string> = {
  admin: 'You would have full control, including sharing it further.',
  member: 'You would be able to read and write everything in it.',
  guest: 'You would be able to read it.',
};

onMounted(refresh);
// a fresh sign-in is a different person with different invitations
watch(() => auth.user?.id, () => void refresh());
// a new invite notification means a new pending invitation, so show it without a reload
const { items } = useNotifications();
watch(
  () => items.value.find((n) => n.kind === 'invite_received' && !n.read)?.id,
  (id) => id && void refresh(),
);

async function answer(workspaceId: string, name: string, accept: boolean) {
  const ok = await respond(workspaceId, accept);
  if (!ok) return notice.warning('That didn’t go through. Try again when you’re back online.');
  if (!accept) return notice.info(`Declined ${name}.`);
  notice.info(`You’ve joined ${name}.`);
  // the pages only arrive on a pull, and waiting for the next poll looks like nothing happened
  void sync.syncNow();
}
</script>

<template>
  <div v-if="invitations.length" class="scrim">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Invitations">
      <header class="head">
        <h2>{{ invitations.length === 1 ? 'You’ve been invited' : 'You’ve been invited to ' + invitations.length + ' projects' }}</h2>
        <p>Nothing is shared with you until you accept.</p>
      </header>

      <div class="list">
        <div v-for="i in invitations" :key="i.workspaceId" class="invite">
          <div class="what">
            <p class="line">
              <strong>{{ i.invitedByName }}</strong> invited you to <strong>{{ i.workspaceName }}</strong>
              as a <span class="role">{{ i.role }}</span>.
            </p>
            <p class="sub">{{ ROLE_SAYS[i.role] ?? '' }}</p>
          </div>
          <div class="acts">
            <BaseButton
              size="sm"
              variant="bordered"
              :disabled="answering === i.workspaceId"
              @click="answer(i.workspaceId, i.workspaceName, false)"
            >
              Decline
            </BaseButton>
            <BaseButton
              size="sm"
              :disabled="answering === i.workspaceId"
              @click="answer(i.workspaceId, i.workspaceName, true)"
            >
              Accept
            </BaseButton>
          </div>
        </div>
      </div>

      <footer class="foot">Declining is final — the person who invited you can invite you again.</footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 140; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(520px, 100%); max-block-size: 82vh; display: flex; flex-direction: column; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }
.head { padding: 22px 24px 16px; border-bottom: 1px solid var(--border); }
.head h2 { font: 800 18px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 5px 0 0; }
.list { overflow-y: auto; padding: 8px; flex: 1; }
.invite { display: flex; align-items: center; gap: 16px; padding: 14px 16px; border-radius: var(--r-item); }
.invite + .invite { border-top: 1px solid var(--divider-faint); }
.what { flex: 1; min-inline-size: 0; }
.line { margin: 0; font: 400 13.5px/1.6 var(--font-ui); color: var(--ink-body); }
.line strong { font-weight: 700; }
.role { text-transform: capitalize; color: var(--accent-deep); font-weight: 600; }
.sub { margin: 4px 0 0; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
.acts { display: flex; align-items: center; gap: 8px; flex: none; }
.foot { padding: 12px 20px; border-top: 1px solid var(--border); font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
</style>
