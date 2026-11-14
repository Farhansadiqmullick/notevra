<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { useNoticeStore } from '@/stores/notice.store';
import { useAuthStore } from '@/stores/auth.store';
import { useProfileStore } from '@/stores/profile.store';
import { debounce } from '@/utils/debounce';
import Dropzone from '@/components/primitives/Dropzone.vue';
import BaseButton from '@/components/primitives/BaseButton.vue';

const ui = useUiStore();
const notice = useNoticeStore();
const auth = useAuthStore();
const profile = useProfileStore();

// "Change" emails a reset link: one password-change path, and it works if you've forgotten the old one
const signingOut = ref(false);
const resending = ref(false);

async function signOut() {
  signingOut.value = true;
  const res = await auth.signOut();
  signingOut.value = false;
  if (res.ok) notice.info('Signed out. Your notes are still here on this device.');
  else notice.danger(res.error ?? 'Could not sign out.', 0);
}

async function resend() {
  resending.value = true;
  const res = await auth.resendConfirmation(auth.email);
  resending.value = false;
  if (res.ok) notice.info(`Confirmation email sent to ${auth.email}.`);
  else notice.danger(res.error ?? 'Could not send it.', 0);
}

async function changePassword() {
  const res = await auth.sendPasswordReset(auth.email);
  if (res.ok) notice.info(`We’ve emailed ${auth.email} a link to set a new password.`);
  else notice.danger(res.error ?? 'Could not send the email.', 0);
}

const uploadError = ref('');

// a local draft, so debounced writes coming back through the store don't re-render the field mid-word
const displayName = ref('');
const writeName = debounce((v: string) => void profile.setName(v), 300);

watch(() => profile.displayName, (v) => { if (v !== displayName.value) displayName.value = v; }, { immediate: true });

function onName(e: Event) {
  displayName.value = (e.target as HTMLInputElement).value;
  writeName(displayName.value);
}

// not a constant: a signed-in profile now syncs to the account (core/sync/profileSync.ts)
const profileHint = computed(() => {
  if (!auth.signedIn) return 'saved on this device — sign in to carry it to your other browsers';
  switch (profile.syncState) {
    case 'syncing': return 'saving to your account…';
    case 'synced': return 'synced to your account';
    case 'error': return 'saved on this device — the server couldn’t be reached';
    default: return 'saved to your account';
  }
});

// same pipeline as every other image: validated, downscaled, WebP, stored by content hash
async function onAvatar(files: File[]) {
  uploadError.value = '';
  try {
    await profile.setAvatar(files[0]!);
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : 'Couldn’t use that image.';
  }
}
</script>

<template>
  <!-- the identity card belongs to an account, so a signed-out browser never shows the last occupant -->
  <div v-if="auth.signedIn" class="card identity">
    <div class="avatar-wrap">
      <Dropzone shape="circle" accept="image/*" :preview-url="profile.avatarUrl ?? undefined" @files="onAvatar" @error="(m) => (uploadError = m)" />
    </div>
    <div class="who">
      <div class="name">{{ profile.label }}</div>
      <div class="email">{{ auth.email }}</div>
      <div class="drop-hint">Drag a photo onto the avatar, or click it to upload</div>
      <div v-if="uploadError" class="err">{{ uploadError }}</div>
    </div>
  </div>
  <div class="card">
    <div v-if="auth.signedIn" class="row">
      <span class="lbl">
        Display name
        <span class="sublbl" :class="{ err: profile.syncState === 'error' }">{{ profileHint }}</span>
      </span>
      <input class="inp" :value="displayName" placeholder="Your name" @input="onName" />
    </div>
    <!-- three states; signed out is not an error, the app works forever without an account -->
    <template v-if="!auth.configured">
      <div class="row">
        <span class="lbl">
          Account
          <span class="sublbl">no server is configured for this build</span>
        </span>
        <span class="val">Local only</span>
      </div>
    </template>

    <!-- `ready` guards a flash of "Sign in" while the stored session is still being restored -->
    <template v-else-if="!auth.ready">
      <div class="row"><span class="lbl">Account</span><span class="val">Checking…</span></div>
    </template>

    <template v-else-if="auth.signedIn">
      <div class="row">
        <span class="lbl">
          Email
          <span v-if="!auth.emailVerified" class="sublbl">not confirmed yet — check your inbox</span>
        </span>
        <span class="val">{{ auth.email }}</span>
      </div>
      <div v-if="!auth.emailVerified" class="row">
        <span class="lbl">
          Confirmation email
          <span class="sublbl">didn’t arrive? we can send it again</span>
        </span>
        <BaseButton size="sm" variant="bordered" :disabled="resending" @click="resend">
          {{ resending ? 'Sending…' : 'Resend' }}
        </BaseButton>
      </div>
      <div class="row">
        <span class="lbl">
          Password
          <span class="sublbl">we email you a link; we never see or store your password</span>
        </span>
        <BaseButton size="sm" variant="bordered" @click="changePassword">Change</BaseButton>
      </div>
      <div class="row">
        <span class="lbl">
          Sign out
          <span class="sublbl">your notes stay on this device — signing out never deletes them</span>
        </span>
        <BaseButton size="sm" variant="bordered" :disabled="signingOut" @click="signOut">
          {{ signingOut ? 'Signing out…' : 'Sign out' }}
        </BaseButton>
      </div>
    </template>

    <template v-else>
      <div class="row">
        <span class="lbl">
          Account
          <span class="sublbl">optional — everything already works without one</span>
        </span>
        <BaseButton size="sm" @click="ui.openAuth('signin')">Sign in</BaseButton>
      </div>
    </template>
  </div>

  <p v-if="auth.signedIn" class="note">
    Signing in does not move your notes anywhere by itself — sync is a separate step, and it
    is not built yet. What an account gives you today is an identity the server recognises.
    Your password is handled by Supabase Auth and hashed there; this app never receives it,
    and there is no password field anywhere in this codebase.
  </p>
  <p v-else class="note">
    Notevra works with no account at all, and that is a supported way to use it forever —
    everything lives in this browser. An account is what lets the same notes reach your
    other browsers and, later, other people. Your name and photo belong to an account, so
    they appear here once you sign in.
  </p>
</template>

<style scoped src="./settings.css"></style>
<style scoped>
.identity { display: flex; gap: 18px; align-items: center; padding: 18px 16px; }
.avatar-wrap { inline-size: 88px; block-size: 88px; flex: none; }
.who { min-width: 0; }
.name { font: 700 15px var(--font-ui); color: var(--ink-body); }
.email { font: 500 12px var(--font-ui); color: var(--ink-muted); margin-top: 2px; }
.drop-hint { font: 500 11.5px var(--font-ui); color: var(--ink-faint); margin-top: 8px; }
</style>
