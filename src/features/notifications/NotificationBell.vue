<script setup lang="ts">
// Page-header bell: unread count, and a dropdown of recent notifications (same shape as Contents).
import { nextTick, onUnmounted, ref, watch } from 'vue';
import { useNotifications, describe } from '@/composables/useNotifications';
import { useAuthStore } from '@/stores/auth.store';
import { ago } from '@/utils/relativeTime';

const auth = useAuthStore();
const { items, unread, refresh, markAllRead, socialOn } = useNotifications();

const open = ref(false);
// ids that were unread when the dropdown opened, so they stay highlighted while it is open
const fresh = ref(new Set<string>());

function toggle() {
  if (open.value) return void (open.value = false);
  fresh.value = new Set(items.value.filter((n) => !n.read).map((n) => n.id));
  open.value = true;
  void refresh();
  void markAllRead();
}

function onDocMouseDown(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.notif-bell')) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
watch(open, (v) => {
  if (v) {
    nextTick(() => document.addEventListener('mousedown', onDocMouseDown));
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onKey);
  }
});
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div v-if="auth.signedIn" class="notif-bell">
    <button
      class="bell-btn"
      :class="{ on: open }"
      :aria-expanded="open"
      :title="!socialOn ? 'Notifications are off' : unread ? `Notifications (${unread} unread)` : 'Notifications'"
      :aria-label="unread ? `Notifications, ${unread} unread` : 'Notifications'"
      @click="toggle"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1.2 1.5H2.8L4 11.5Z" /><path d="M6.5 14.5a1.6 1.6 0 0 0 3 0" />
      </svg>
      <span v-if="unread" class="count">{{ unread > 9 ? '9+' : unread }}</span>
    </button>

    <div v-if="open" class="menu" role="dialog" aria-label="Notifications">
      <div class="menu-head">NOTIFICATIONS</div>
      <p v-if="!socialOn" class="empty">Notifications are off. Turn them on in Settings → Notifications.</p>
      <p v-else-if="!items.length" class="empty">Nothing yet. Invitations and their answers show up here.</p>
      <ul v-else class="list">
        <li v-for="n in items" :key="n.id" class="item" :class="{ fresh: fresh.has(n.id) }">
          <span class="dot" aria-hidden="true" />
          <div class="body">
            <p class="line">{{ describe(n) }}</p>
            <p class="when">{{ ago(n.at) }}</p>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.notif-bell { position: relative; flex: none; }
.bell-btn {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  border: 1px solid var(--border-strong); background: var(--surface); border-radius: var(--r-control);
  padding: 5px 8px; font: 600 11.5px var(--font-ui); color: var(--ink-muted);
}
.bell-btn:hover, .bell-btn.on { color: var(--ink-body); border-color: var(--border-hover); background: var(--surface-subtle); }
.count { font: 700 10px/1 var(--font-ui); color: #fff; background: var(--accent); border-radius: 999px; padding: 2px 5px; }

.menu {
  position: absolute; inset-block-start: calc(100% + 6px); inset-inline-start: 0; z-index: 80;
  inline-size: min(300px, calc(100vw - 24px)); max-block-size: 60vh; overflow-y: auto;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item);
  box-shadow: var(--sh-pop, var(--sh-hairline)); padding: 8px;
}
.menu-head { font: 700 9.5px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); padding: 4px 8px 8px; }
.empty { margin: 0; padding: 8px; font: 500 12px/1.6 var(--font-ui); color: var(--ink-faint); }
.list { list-style: none; margin: 0; padding: 0; }
.item { display: flex; gap: 9px; padding: 8px; border-radius: var(--r-row); }
.item.fresh { background: var(--accent-tint); }
.dot { flex: none; inline-size: 7px; block-size: 7px; margin-block-start: 6px; border-radius: 50%; background: transparent; }
.item.fresh .dot { background: var(--accent); }
.body { min-inline-size: 0; }
.line { margin: 0; font: 500 12.5px/1.5 var(--font-ui); color: var(--ink-secondary); }
.when { margin: 2px 0 0; font: 500 11px var(--font-ui); color: var(--ink-faint); }
</style>
