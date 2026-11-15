<script setup lang="ts">
/**
 * AppSidebar — the shared 250px navigation column.
 *
 * Boundary: 100% props-in / events-out. It holds NO data and does NO navigation itself —
 * a parent supplies the tree and handles the emitted intents.
 */
import { computed } from 'vue';
import BrandMark from './BrandMark.vue';
import { useGroupRename } from './useGroupRename';
import TypeGlyph from '@/components/primitives/TypeGlyph.vue';
import { shortcut } from '@/utils/platform';
import type { SmartList, SidebarGroup } from '@/types/models';
import AppIcon from '@/components/primitives/AppIcon.vue';

const props = withDefaults(
  defineProps<{
    brandName?: string;
    /** shown in the footer account chip */
    userName?: string;
    userAvatarUrl?: string | null;
    smartLists?: SmartList[];
    /** the open smart list, so its row reads as current */
    activeSmartList?: string | null;
    groups?: SidebarGroup[];
    activeNoteId?: string;
    trashCount?: number;
    archiveCount?: number;
    /** signed in, so projects you administer get an invite button */
    canInvite?: boolean;
  }>(),
  {
    brandName: 'Notevra', userName: 'You', userAvatarUrl: null, smartLists: () => [], activeSmartList: null,
    groups: () => [], trashCount: 0, archiveCount: 0,
  },
);

const emit = defineEmits<{
  openSearch: [];
  /** create a project — a space alongside PERSONAL, not a page inside one */
  newProject: [];
  /** the group-level `+`: a new page, filed into THIS space */
  newPageIn: [workspaceId: string];
  /** a project was renamed in place. The sidebar holds the draft; the parent owns the write. */
  renameGroup: [payload: { id: string; name: string }];
  /** right-click on a project; admin items only when `manageable` */
  projectMenu: [payload: { id: string; name: string; pages: number; manageable: boolean; x: number; y: number }];
  inviteTo: [payload: { id: string; name: string }];
  selectSmartList: [id: string];
  selectNote: [id: string];
  toggleGroup: [id: string];
  noteMenu: [payload: { id: string; x: number; y: number }];
  openArchive: [];
  openSettings: [];
  /** the Delete key on a focused page row */
  deletePage: [id: string];
  /** the Delete key on a focused project header */
  deleteProject: [payload: { id: string; name: string; pages: number }];
}>();

// Delete on a project header: only where you could delete it from its menu too
function onGroupDeleteKey(g: SidebarGroup) {
  if (g.personal || !g.manageable || renamingId.value === g.id) return;
  emit('deleteProject', { id: g.id, name: g.name, pages: g.notes.length });
}

const searchShortcut = shortcut('K');

const userInitial = computed(() => props.userName.trim().charAt(0).toUpperCase() || 'Y');
const archiveTotal = computed(() => props.archiveCount + props.trashCount);

// Personal first, then everything else under a Projects heading
const sections = computed(() => [
  { id: 'personal', groups: props.groups.filter((g) => g.personal) },
  { id: 'projects', groups: props.groups.filter((g) => !g.personal) },
]);

const { renamingId, renameDraft, renameInput, startRename, commitRename, startRenameById } = useGroupRename(
  () => props.groups,
  (payload) => emit('renameGroup', payload),
);

// any project opens the menu, members included; PERSONAL has none
function onGroupContext(g: SidebarGroup, e: MouseEvent) {
  if (g.personal) return;
  e.preventDefault();
  emit('projectMenu', { id: g.id, name: g.name, pages: g.notes.length, manageable: !!g.manageable, x: e.clientX, y: e.clientY });
}

defineExpose({ startRenameById });

// right-click (desktop) and press-and-hold ~2s (mobile) open the note context menu
function onContext(id: string, e: MouseEvent) {
  emit('noteMenu', { id, x: e.clientX, y: e.clientY });
}
let holdTimer: ReturnType<typeof setTimeout> | null = null;
function onTouchStart(id: string, e: TouchEvent) {
  const t = e.touches[0];
  const x = t.clientX;
  const y = t.clientY;
  clearHold();
  holdTimer = setTimeout(() => emit('noteMenu', { id, x, y }), 2000);
}
function clearHold() {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
}
</script>

<template>
  <nav class="sidebar">
    <!-- brand -->
    <header class="brand">
      <BrandMark :size="34" />
      <span class="brand-name">{{ brandName }}</span>
    </header>

    <!-- quick navigation -->
    <ul class="nav">
      <li>
        <button type="button" class="row nav-row" @click="emit('openSearch')">
          <span class="nav-ic" aria-hidden="true">
            <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
          </span>
          <span class="row-label">Search</span>
          <kbd class="kbd">{{ searchShortcut }}</kbd>
        </button>
      </li>
      <li v-for="sl in smartLists" :key="sl.id">
        <button
          type="button"
          class="row nav-row"
          :class="{ active: sl.id === activeSmartList }"
          :aria-current="sl.id === activeSmartList ? 'page' : undefined"
          @click="emit('selectSmartList', sl.id)"
        >
          <span class="nav-ic" :style="{ color: sl.color }" aria-hidden="true">
            <svg v-if="sl.id === 'today'" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
            </svg>
            <svg v-else-if="sl.id === 'temp'" viewBox="0 0 16 16">
              <path d="M8 13.5h6" /><path d="M11 2.5a1.4 1.4 0 0 1 2 2L5 12.5l-2.7.7.7-2.7Z" />
            </svg>
            <span v-else class="nav-sq" :style="{ background: sl.color }" />
          </span>
          <span class="row-label">{{ sl.label }}</span>
          <span v-if="sl.count" class="count">{{ sl.count }}</span>
        </button>
      </li>
    </ul>

    <!-- spaces + page tree -->
    <div class="tree">
      <div v-for="s in sections" :key="s.id" class="section" :class="s.id">
        <div v-if="s.id === 'projects'" class="section-head">
          <span class="section-title">Projects</span>
          <button type="button" class="add" title="New project" aria-label="New project" @click="emit('newProject')">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
          </button>
        </div>

        <section v-for="g in s.groups" :key="g.id" class="group" :class="{ project: !g.personal }">
          <div class="group-head" :class="{ project: !g.personal }" @contextmenu="onGroupContext(g, $event)">
            <button type="button" class="group-toggle" :aria-expanded="!g.collapsed" @click="emit('toggleGroup', g.id)" @keydown.delete.self.prevent="onGroupDeleteKey(g)">
              <svg class="caret" :class="{ open: !g.collapsed }" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
              <!-- the input lives outside any button: an input inside a button is invalid and swallows clicks -->
              <input
                v-if="renamingId === g.id"
                ref="renameInput"
                v-model="renameDraft"
                class="group-name group-rename"
                @click.stop
                @keydown.enter.prevent="commitRename(g)"
                @keydown.esc.prevent="renamingId = null"
                @blur="commitRename(g)"
              />
              <span
                v-else
                class="group-name"
                :class="{ editable: g.manageable }"
                :title="g.manageable ? 'Double-click to rename' : undefined"
                @dblclick.stop="startRename(g)"
              >{{ g.name }}</span>
              <span v-if="g.shared" class="shared-tag" title="Someone else's project: you can add and edit pages; only its admins can rename, share or delete it">shared</span>
            </button>
            <button
              v-if="canInvite && g.manageable"
              type="button"
              class="add"
              :title="`Invite people to ${g.name}`"
              :aria-label="`Invite people to ${g.name}`"
              @click="emit('inviteTo', { id: g.id, name: g.name })"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="6" cy="5.5" r="2.5" /><path d="M1.5 13.5c.6-2.3 2.3-3.5 4.5-3.5s3.9 1.2 4.5 3.5M12.5 5v5M10 7.5h5" />
              </svg>
            </button>
            <!-- members may add pages (the server allows it); only admin actions are gated -->
            <button
              type="button"
              class="add"
              :title="`New page in ${g.name}`"
              :aria-label="`New page in ${g.name}`"
              @click="emit('newPageIn', g.id)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
            </button>
          </div>

          <ul v-show="!g.collapsed" class="pages">
            <li v-for="n in g.notes" :key="n.id">
              <button
                type="button"
                class="row page-row"
                :class="{ active: n.id === activeNoteId }"
                :aria-current="n.id === activeNoteId ? 'page' : undefined"
                @click="emit('selectNote', n.id)"
                @keydown.delete.prevent="emit('deletePage', n.id)"
                @contextmenu.prevent="onContext(n.id, $event)"
                @touchstart.passive="onTouchStart(n.id, $event)"
                @touchend="clearHold"
                @touchmove="clearHold"
                @touchcancel="clearHold"
              >
                <TypeGlyph :type="n.type" :muted="n.muted" :size="16" />
                <span class="row-label">{{ n.title }}</span>
                <span v-if="n.pinned" class="pin" title="Pinned" aria-label="Pinned"><AppIcon name="pin" /></span>
              </button>
            </li>
            <li v-if="!g.notes.length" class="empty">
              <button type="button" class="empty-add" @click="emit('newPageIn', g.id)">+ Add a page</button>
            </li>
          </ul>
        </section>

        <!-- with no projects yet, say what the section is for -->
        <button v-if="s.id === 'projects' && !s.groups.length" type="button" class="empty-add empty-project" @click="emit('newProject')">
          + Create your first project
        </button>
      </div>
    </div>

    <!-- account + utilities; Trash lives inside the Archive dialog as a tab -->
    <footer class="foot">
      <button type="button" class="me" title="Your profile and settings" @click="emit('openSettings')">
        <img v-if="userAvatarUrl" class="me-avatar" :src="userAvatarUrl" alt="" />
        <span v-else class="me-avatar" aria-hidden="true">{{ userInitial }}</span>
        <span class="me-name">{{ userName }}</span>
      </button>
      <button type="button" class="foot-btn" title="Archive" @click="emit('openArchive')">
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="3.5" rx="1" /><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3" /></svg>
        <span class="sr-only">Archive</span>
        <span v-if="archiveTotal" class="badge">{{ archiveTotal }}</span>
      </button>
      <button type="button" class="foot-btn" title="Settings" @click="emit('openSettings')">
        <svg class="ic24" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span class="sr-only">Settings</span>
      </button>
    </footer>
  </nav>
</template>

<style scoped>
/* longhands throughout: `font: … inherit` is invalid and the browser drops the whole line */
.sidebar {
  inline-size: 250px;
  flex: none;
  block-size: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-subtle);
  border-inline-end: 1px solid var(--border);
  font-family: var(--font-ui), sans-serif;
}
svg { inline-size: 16px; block-size: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
svg.ic24 { stroke-width: 2.1; }

/* brand */
.brand { display: flex; align-items: center; gap: 11px; padding: 20px 18px 18px; }
.brand-name {
  font-size: 21px; font-weight: 800; line-height: 1; letter-spacing: -0.035em;
  background: linear-gradient(100deg, var(--ink-body) 35%, var(--accent) 130%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}

/* rows shared */
.row {
  position: relative;
  display: flex; align-items: center; gap: 10px; inline-size: calc(100% - 20px);
  margin: 1px 10px; padding: 7px 10px; border-radius: 9px;
  background: transparent; border: none; cursor: pointer; text-align: start;
  transition: background-color 120ms ease-out;
}
.row:hover { background: var(--divider-faint); }
.row-label {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 500; line-height: 1.2; color: var(--ink-secondary);
}
.row.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.row.active .row-label { color: var(--accent-deep); font-weight: 650; }
.row.active::before {
  content: ''; position: absolute; inset-inline-start: -6px; inset-block: 8px;
  inline-size: 3px; border-radius: 3px; background: var(--accent);
}

/* quick navigation */
.nav { list-style: none; margin: 0 0 6px; padding: 0; }
.nav-ic { flex: none; display: grid; place-items: center; inline-size: 18px; color: var(--ink-faint); }
.nav-sq { inline-size: 12px; block-size: 12px; border-radius: 4px; }
.kbd {
  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; line-height: 1;
  color: var(--ink-faint); background: var(--surface); border: 1px solid var(--border);
  border-radius: 5px; padding: 3px 5px;
  opacity: 0; transition: opacity 120ms ease-out;
}
/* the shortcut is a hint, so it appears only when you reach for the row; touch screens never see it */
.row:hover .kbd, .row:focus-visible .kbd { opacity: 1; }
@media (hover: none) { .kbd { display: none; } }
.count {
  min-inline-size: 20px; padding: 3px 6px; border-radius: 999px; text-align: center;
  font-size: 10.5px; font-weight: 700; line-height: 1; color: var(--ink-muted);
  background: var(--surface-muted);
}
.row.active .count { color: var(--accent-deep); background: color-mix(in srgb, var(--accent) 16%, transparent); }

/* spaces + tree */
.tree { flex: 1; overflow-y: auto; padding-block-end: 12px; }
.section { margin-block-start: 14px; }

/* PERSONAL and PROJECTS share one heading style so they read as equals */
.section-head, .group-head:not(.project) {
  display: flex; align-items: center; gap: 4px; padding: 0 12px 0 20px; min-block-size: 26px;
}
.section-title, .group-head:not(.project) .group-name {
  font-size: 10.5px; font-weight: 700; line-height: 1; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-faint);
}
.section-title { flex: 1; }

.group-head { display: flex; align-items: center; gap: 2px; padding-inline-end: 12px; }
.group-head.project { padding-inline-start: 14px; min-block-size: 30px; }
.group-toggle {
  display: flex; align-items: center; gap: 6px; flex: 1; min-inline-size: 0;
  padding: 4px 0; background: transparent; border: none; cursor: pointer;
}
/* on the PERSONAL heading the caret follows the label, so both headings start on the same line */
.group-head:not(.project) .group-name { flex: 0 1 auto; }
.group-head:not(.project) .caret { order: 2; }
.caret { flex: none; inline-size: 12px; block-size: 12px; color: var(--ink-ghost); stroke-width: 2; transition: transform 140ms ease-out; }
.caret.open { transform: rotate(90deg); }
.group-name { flex: 1; min-inline-size: 0; text-align: start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-name.editable { cursor: text; }
/* project names in normal case, so they read as items under PROJECTS rather than more headings */
.group-head.project .group-name { font-size: 13px; font-weight: 600; line-height: 1.2; color: var(--ink-body); }
.group-rename {
  border: none; background: var(--surface); color: var(--ink-body);
  border-radius: var(--r-bar); padding: 2px 4px; margin: -2px 0;
  outline: 1.5px solid var(--accent);
}
.add {
  flex: none; inline-size: 24px; block-size: 24px; display: grid; place-items: center;
  color: var(--ink-ghost); background: transparent; border: none; border-radius: 7px; cursor: pointer;
  transition: color 120ms ease-out, background-color 120ms ease-out;
}
.add svg { inline-size: 14px; block-size: 14px; }
.add:hover { color: var(--accent-deep); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.shared-tag {
  flex: none; font-size: 8.5px; font-weight: 700; line-height: 1; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--accent-deep); background: var(--accent-tint); border-radius: var(--r-tag); padding: 3px 5px;
}

.pages { list-style: none; margin: 0 0 4px; padding: 0; }
/* project pages sit under the project name, past its caret */
.group.project .page-row { padding-inline-start: 22px; }
.page-row .pin { flex: none; font-size: 11px; line-height: 1; }

.empty { padding: 2px 0; }
.empty-add {
  display: block; padding: 6px 12px 6px 20px; background: transparent; border: none; cursor: pointer; text-align: start;
  font-size: 12px; font-weight: 600; line-height: 1.2; color: var(--ink-ghost);
}
.empty-add:hover { color: var(--accent-deep); }
.group.project .empty-add { padding-inline-start: 32px; }

/* footer: account chip + utilities */
.foot {
  display: flex; align-items: center; gap: 2px;
  margin: 0 10px 10px; padding: 6px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--border);
}
.me {
  flex: 1; min-inline-size: 0; display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; border-radius: 8px; background: transparent; border: none; cursor: pointer; text-align: start;
}
.me:hover { background: var(--divider-faint); }
.me-avatar {
  flex: none; display: grid; place-items: center; inline-size: 26px; block-size: 26px; border-radius: 50%; object-fit: cover;
  background: linear-gradient(135deg, var(--accent-mid), var(--accent-hover)); color: #fff;
  font-size: 11.5px; font-weight: 700; line-height: 1;
}
.me-name {
  min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px; font-weight: 600; line-height: 1.2; color: var(--ink-body);
}
.foot-btn {
  position: relative; flex: none; display: grid; place-items: center; inline-size: 32px; block-size: 32px;
  background: transparent; border: none; border-radius: 8px; cursor: pointer; color: var(--ink-muted);
}
.foot-btn:hover { color: var(--ink-body); background: var(--divider-faint); }
.badge {
  position: absolute; inset-block-start: 2px; inset-inline-end: 1px;
  min-inline-size: 15px; padding: 2px 4px; border-radius: 999px;
  font-size: 9px; font-weight: 700; line-height: 1; color: #fff; background: var(--accent);
}
.sr-only {
  position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; margin: -1px; padding: 0; border: 0;
}

.row:focus-visible, .group-toggle:focus-visible, .add:focus-visible, .me:focus-visible, .foot-btn:focus-visible, .empty-add:focus-visible {
  outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 9px;
}
@media (prefers-reduced-motion: reduce) {
  .row, .add, .caret { transition: none; }
}
</style>
