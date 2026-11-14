<script setup lang="ts">
import { onMounted } from 'vue';
import BaseButton from '@/components/primitives/BaseButton.vue';
import { entryText, loadDiagnostics, short, showDiagnostics, time, useSyncDiagnostics } from './useSyncDiagnostics';

const { diag, copying, copied, cursorText, copyDiagnostics } = useSyncDiagnostics();

onMounted(() => void loadDiagnostics());
</script>

<template>
  <!-- first row matters most: the account this database belongs to beside the one signed in -->
  <div v-if="showDiagnostics" class="card">
    <div class="sec-title">Sync diagnostics</div>
    <div class="row">
      <span class="lbl">
        This database belongs to
        <span class="sublbl">and who is signed in now — these must match</span>
      </span>
      <span class="val mono" :class="{ mismatch: diag && diag.databaseAccount !== diag.signedInAccount }">
        {{ short(diag?.databaseAccount) }} → {{ short(diag?.signedInAccount) }}
      </span>
    </div>
    <div class="row">
      <span class="lbl">
        Supabase session
        <span class="sublbl">the app can show an account while the server has no session</span>
      </span>
      <span class="val mono" :class="{ mismatch: diag?.signedInAccount && diag.sessionPresent === false }">
        {{ diag?.sessionPresent === null ? 'no server' : diag?.sessionPresent ? 'present' : 'none' }}
      </span>
    </div>
    <div class="row">
      <span class="lbl">This device</span>
      <span class="val mono">{{ short(diag?.device) }}</span>
    </div>
    <div class="row">
      <span class="lbl">
        Pull cursor
        <span class="sublbl">how far into the server's log this device has read</span>
      </span>
      <span class="val mono">{{ cursorText }}</span>
    </div>
    <div class="row" v-for="(c, name) in diag?.tables ?? {}" :key="name">
      <span class="lbl">{{ name }}</span>
      <span class="val mono">{{ c.rows }} rows · {{ c.dirty }} unsent · {{ c.synced }} on server</span>
    </div>
    <div class="row">
      <span class="lbl">
        Recent sync activity
        <span class="sublbl">newest first — every push and every pull, with the server's own words</span>
      </span>
      <BaseButton size="sm" variant="bordered" :disabled="copying" @click="copyDiagnostics">
        {{ copied ? 'Copied' : 'Copy diagnostics' }}
      </BaseButton>
    </div>
    <div v-if="diag" class="log">
      <div v-for="e in diag.recent" :key="e.id" class="log-row" :class="{ bad: !e.ok }">
        <span class="log-t">{{ time(e.ts) }}</span>
        <span class="log-k">{{ e.kind }}</span>
        <span class="log-d">{{ entryText(e) }}</span>
      </div>
      <div v-if="!diag.recent.length" class="log-empty">
        Nothing recorded yet. Entries appear as this device pushes and pulls.
      </div>
    </div>
  </div>
  <p v-if="showDiagnostics" class="note">
    Diagnostics are read from this device only, on demand — nothing is sent anywhere. “Copy
    diagnostics” puts the whole thing on your clipboard as JSON, including the last 50 sync
    events and any failing rows with the server's verbatim reason.
  </p>
</template>

<style scoped src="../settings.css"></style>
<style scoped>
/* monospace and tabular figures: every value is an id, a count or a cursor, compared line by line */
.val.mono {
  font: 500 11.5px 'JetBrains Mono Variable', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  text-align: end;
}
/* the account mismatch — the one state in this panel that is a finding rather than a fact */
.val.mismatch { color: var(--danger-deep); font-weight: 700; }

.log {
  margin-top: 4px;
  max-block-size: 260px;
  overflow-y: auto;
  border-top: 1px solid var(--divider-faint);
}
.log-row {
  display: grid;
  grid-template-columns: 72px 52px 1fr;
  gap: 8px;
  padding: 5px 0;
  font: 500 10.5px/1.5 'JetBrains Mono Variable', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  border-block-end: 1px solid var(--divider-faint);
}
.log-row:last-child { border-block-end: none; }
.log-t { color: var(--ink-faint); }
.log-k { color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.log-d { color: var(--ink-body); overflow-wrap: anywhere; }
.log-row.bad .log-k,
.log-row.bad .log-d { color: var(--danger-deep); }
.log-empty { padding: 12px 0; font: 500 11.5px var(--font-ui); color: var(--ink-faint); }
</style>
