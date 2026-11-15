<script setup lang="ts">
// Settings → Notifications. Per device; the master switch silences everything under it.
import { ref } from 'vue';
import { useNotificationPrefs, type ConflictAlert } from '@/composables/useNotificationPrefs';
import { createChime, TONES, type ToneId } from '@/core/reminders/chime';
import { askToNotify, notifyPermission } from '@/core/reminders/systemNotify';

const { prefs } = useNotificationPrefs();

const TONE_IDS = Object.keys(TONES) as ToneId[];
const chime = createChime();
function pickTone(id: ToneId) {
  prefs.tone = id;
  void chime.play(id);
}

const permission = ref(notifyPermission());
const PERMISSION_SAYS = {
  granted: 'On. A reminder that comes due while Notevra is in the background shows as a system notification.',
  default: 'Notevra asks the first time you snooze something, or you can allow it now.',
  denied: 'Blocked in your browser or system settings. Reminders still show inside Notevra.',
  unsupported: 'This browser has no system notifications. Reminders show inside Notevra.',
} as const;
async function allow() {
  await askToNotify();
  permission.value = notifyPermission();
}

const CONFLICT_OPTIONS: { id: ConflictAlert; label: string }[] = [
  { id: 'banner', label: 'Banner' },
  { id: 'sound', label: 'Banner + sound' },
  { id: 'quiet', label: 'Quiet' },
];
const CONFLICT_SAYS: Record<ConflictAlert, string> = {
  banner: 'A banner at the bottom of the app until you decide.',
  sound: 'The banner, plus a chime when a new conflict arrives.',
  quiet: 'No banner. The sidebar sync line and Sync & Storage still show it.',
};

function setTime(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) prefs.dueTime = v;
}
</script>

<template>
  <div class="card">
    <div class="row">
      <span class="lbl">
        Notifications
        <span class="sublbl">Off silences everything below on this device</span>
      </span>
      <button class="switch" role="switch" :aria-checked="prefs.enabled" aria-label="Notifications" @click="prefs.enabled = !prefs.enabled" />
    </div>

    <div class="row" :class="{ dim: !prefs.enabled }">
      <span class="lbl">
        Due reminders
        <span class="sublbl">A chime and a notice on the due day for tasks and pages that aren't done</span>
      </span>
      <input
        type="time"
        class="time"
        :value="prefs.dueTime"
        :disabled="!prefs.enabled || !prefs.due"
        aria-label="Reminder time"
        @change="setTime"
      />
      <button class="switch" role="switch" :aria-checked="prefs.due" :disabled="!prefs.enabled" aria-label="Due reminders" @click="prefs.due = !prefs.due" />
    </div>

    <div class="row col" :class="{ dim: !prefs.enabled }">
      <span class="lbl">
        Reminder sound
        <span class="sublbl">Plays when a snooze runs out or something is due. Pick one to hear it.</span>
      </span>
      <div class="seg" role="radiogroup" aria-label="Reminder sound">
        <button
          v-for="id in TONE_IDS"
          :key="id"
          role="radio"
          :aria-checked="prefs.tone === id"
          :class="{ on: prefs.tone === id }"
          :disabled="!prefs.enabled"
          @click="pickTone(id)"
        >{{ TONES[id].label }}</button>
      </div>
      <button class="play" :disabled="!prefs.enabled" @click="chime.play(prefs.tone)">▶ Play</button>
    </div>

    <div class="row" :class="{ dim: !prefs.enabled }">
      <span class="lbl">
        System notifications
        <span class="sublbl">{{ PERMISSION_SAYS[permission] }}</span>
      </span>
      <button v-if="permission === 'default'" class="play" :disabled="!prefs.enabled" @click="allow">Allow</button>
    </div>

    <div class="row" :class="{ dim: !prefs.enabled }">
      <span class="lbl">
        Invitations, mentions &amp; comments
        <span class="sublbl">The 🔔 in the page header: invites, accepted, declined. Mentions and comments join here once they exist. You can always answer an invitation.</span>
      </span>
      <button class="switch" role="switch" :aria-checked="prefs.social" :disabled="!prefs.enabled" aria-label="Invitations, mentions and comments" @click="prefs.social = !prefs.social" />
    </div>

    <div class="row col" :class="{ dim: !prefs.enabled }">
      <span class="lbl">
        Sync conflict alerts
        <span class="sublbl">A conflict always waits for your decision, so it can't be switched off.</span>
      </span>
      <div class="seg" role="radiogroup" aria-label="Sync conflict alerts">
        <button
          v-for="o in CONFLICT_OPTIONS"
          :key="o.id"
          role="radio"
          :aria-checked="prefs.conflicts === o.id"
          :class="{ on: prefs.conflicts === o.id }"
          :disabled="!prefs.enabled"
          @click="prefs.conflicts = o.id"
        >{{ o.label }}</button>
      </div>
      <span class="sublbl">{{ prefs.enabled ? CONFLICT_SAYS[prefs.conflicts] : CONFLICT_SAYS.quiet }}</span>
    </div>
  </div>
  <p class="note">Snoozed items still come back when notifications are off; only the sound and the notice stop. Reminders run while Notevra is open, in one tab at a time. Snooze from the keyboard with ⌥S (Alt+S).</p>
</template>

<style scoped>
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-item); box-shadow: var(--sh-hairline); padding: 8px 16px; margin-bottom: 12px; }
.row { display: flex; align-items: center; gap: 12px; padding: 14px 0; border-top: 1px solid var(--divider-faint); }
.row:first-child { border-top: none; }
.row.col { flex-direction: column; align-items: flex-start; gap: 8px; }
.row.dim .lbl { opacity: 0.55; }
.lbl { flex: 1; font: 500 13px var(--font-ui); color: var(--ink-body); }
.sublbl { display: block; font: 500 11px/1.5 var(--font-ui); color: var(--ink-faint); margin-top: 3px; }
.note { font: 400 11.5px/1.6 var(--font-ui); color: var(--ink-faint); margin: 0 2px 20px; }

.switch { position: relative; flex: none; inline-size: 34px; block-size: 20px; border-radius: 999px; border: none; cursor: pointer; background: var(--border-strong); transition: background 0.15s; }
.switch::after { content: ''; position: absolute; inset-block-start: 2px; inset-inline-start: 2px; inline-size: 16px; block-size: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); transition: transform 0.15s; }
.switch[aria-checked='true'] { background: var(--accent); }
.switch[aria-checked='true']::after { transform: translateX(14px); }
.switch:disabled { cursor: default; opacity: 0.45; }
.switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.time { border: 1px solid var(--border-strong); border-radius: var(--r-control); padding: 4px 8px; font: 500 12px var(--font-ui); color: var(--ink-body); background: var(--surface); }
.time:disabled { opacity: 0.5; }

.seg { display: inline-flex; flex-wrap: wrap; gap: 2px; background: var(--surface-muted); border-radius: var(--r-nav); padding: 3px; }
.seg button { border: none; background: none; cursor: pointer; padding: 6px 12px; border-radius: 6px; font: 600 12px var(--font-ui); color: var(--ink-muted); }
.seg button.on { background: var(--surface); color: var(--ink-body); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.seg button:disabled { cursor: default; opacity: 0.6; }
.play { flex: none; border: 1px solid var(--border-strong); background: var(--surface); border-radius: var(--r-control); padding: 5px 11px; font: 600 12px var(--font-ui); color: var(--ink-body); cursor: pointer; }
.play:hover:not(:disabled) { border-color: var(--border-hover); }
.play:disabled { cursor: default; opacity: 0.5; }
</style>
