<script setup lang="ts">
/**
 * AuthDialog — sign in, create an account, ask for a reset link, set a new password.
 *
 * One dialog with four modes rather than four dialogs, because they are one flow with one shape:
 * the same field, the same footer, the same error line. Switching between them should feel like the
 * panel changing its mind, not like being sent somewhere else.
 *
 * **It is a dialog, not a page, and it is always dismissible.** There is no router here, but more to
 * the point there is nothing to route *to*: the app behind this is fully usable signed out. A modal
 * you cannot escape would be claiming otherwise. The one exception is `reset` — arriving from an
 * email link with a half-finished password change is the single moment where leaving strands you.
 */
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useAuthStore } from '@/stores/auth.store';
import { useNoticeStore } from '@/stores/notice.store';
import BaseButton from '@/components/primitives/BaseButton.vue';
import AppIcon from '@/components/primitives/AppIcon.vue';
import GoogleButton from './GoogleButton.vue';
import PasswordEye from './PasswordEye.vue';
import { AUTH_COPY, type AuthMode as Mode } from './authCopy';
import { useDisplayNameCheck } from './useDisplayNameCheck';

// must match `minimum_password_length` in supabase/config.toml and the dashboard
const MIN_NEW_PASSWORD = 10;

const props = withDefaults(defineProps<{ initialMode?: Mode; initialEmail?: string }>(), {
  initialMode: 'signin',
  initialEmail: '',
});
const emit = defineEmits<{ close: [] }>();

const auth = useAuthStore();
const notice = useNoticeStore();

const mode = ref<Mode>(props.initialMode);
const email = ref(props.initialEmail);
const password = ref('');
const confirmPassword = ref('');
// one toggle for both fields, so the confirm field never disagrees with the one it checks
const showPassword = ref(false);
const busy = ref(false);
const error = ref('');
const hint = ref('');
/** shown instead of the form once an action's result is "go and read your email" */
const sent = ref<'confirm' | 'reset' | null>(null);

// required at sign-up: it is how people find you when they share a project
const { displayName, nameState, suggestion } = useDisplayNameCheck(mode);

const copy = computed(() => AUTH_COPY[mode.value]);
const needsPassword = computed(() => mode.value !== 'forgot');
const needsEmail = computed(() => mode.value !== 'reset');

/**
 * The password placeholder, which is a different sentence when signing IN.
 *
 * "At least 10 characters" is a rule for choosing a password, and it belongs where one is being
 * chosen. Shown at sign-in it reads as a hint about the password you already have — mildly
 * confusing on its own, and actively misleading to anyone whose account predates the rule.
 */
const passwordHint = computed(() =>
  mode.value === 'signin' ? 'Enter your password' : `At least ${MIN_NEW_PASSWORD} characters`,
);

const emailLooksValid = computed(() => /^\S+@\S+\.\S+$/.test(email.value.trim()));
const canSubmit = computed(() => {
  if (busy.value) return false;
  if (needsEmail.value && !emailLooksValid.value) return false;
  // new passwords follow `minimum_password_length`; sign-in still accepts older 6-character ones
  if (needsPassword.value && password.value.length < (mode.value === 'signin' ? 6 : MIN_NEW_PASSWORD)) return false;
  if (mode.value === 'signup' && !displayName.value.trim()) return false;
  if (mode.value === 'signup' && confirmPassword.value !== password.value) return false;
  return true;
});

// only once they have typed in the confirm field — an empty one is unfinished, not wrong
const passwordsDiffer = computed(
  () => mode.value === 'signup' && confirmPassword.value.length > 0 && confirmPassword.value !== password.value,
);

/**
 * Focus the first field that this mode actually shows — `reset` has no email input, so focusing
 * "the email field" would land nowhere and leave the user clicking into a one-field form.
 */
const emailField = ref<HTMLInputElement | null>(null);
const passwordField = ref<HTMLInputElement | null>(null);
onMounted(() => (emailField.value ?? passwordField.value)?.focus());
// a mode change is a different question; clear the last answer's error rather than leaving it
watch(mode, () => {
  error.value = '';
  hint.value = '';
  sent.value = null;
  confirmPassword.value = '';
  showPassword.value = false;
});

async function submit() {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = '';

  const res =
    mode.value === 'signin'
      ? await auth.signIn(email.value, password.value)
      : mode.value === 'signup'
        ? await auth.signUp(email.value, password.value, displayName.value)
        : mode.value === 'forgot'
          ? await auth.sendPasswordReset(email.value)
          : await auth.updatePassword(password.value);

  busy.value = false;

  if (res.exists) {
    mode.value = 'signin';
    await nextTick(); // let the mode watcher clear first, or it wipes this message
    hint.value = res.error ?? '';
    passwordField.value?.focus();
    return;
  }
  if (!res.ok) {
    error.value = res.error ?? 'That didn’t work.';
    return;
  }

  if (mode.value === 'signup' && res.needsConfirmation) {
    sent.value = 'confirm';
    return;
  }
  if (mode.value === 'forgot') {
    sent.value = 'reset';
    return;
  }

  notice.info(
    mode.value === 'reset' ? 'Password updated.' : mode.value === 'signup' ? 'Account created.' : 'Signed in.',
  );
  emit('close');
}

// Esc or ×; no scrim click, because a drag released outside the card fires click on the scrim
function dismiss() {
  if (mode.value === 'reset') return;
  emit('close');
}

// desktop Google: the session arrives later from the browser; the store already says "Signed in as …"
const waitingForGoogle = ref(false);
watch(
  () => auth.user,
  (now, before) => {
    if (waitingForGoogle.value && now && !before) emit('close');
  },
);
</script>

<template>
  <div class="scrim" @keydown.esc="dismiss">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="auth-h">
      <header class="head">
        <h2 id="auth-h">{{ copy.title }}</h2>
        <p>{{ copy.blurb }}</p>
        <button v-if="mode !== 'reset'" type="button" class="x" aria-label="Close" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </header>

      <GoogleButton
        v-if="!sent && (mode === 'signin' || mode === 'signup')"
        @error="(m) => (error = m)"
        @waiting="waitingForGoogle = true"
      />

      <!-- "we sent you an email" replaces the form entirely: leaving the fields on screen invites
           people to submit again while the first message is still in flight -->
      <div v-if="sent" class="body">
        <div class="sent">
          <p v-if="sent === 'confirm'">
            Check <strong>{{ email }}</strong> for a link to confirm your account. You can close this
            and keep working — nothing is waiting on it.
          </p>
          <p v-else>
            If <strong>{{ email }}</strong> has an account, a reset link is on its way. The link works
            once and expires.
          </p>
        </div>
      </div>

      <!--
        `id` so the footer's Sign in button can claim this form with `form="auth-form"`.

        Without that pairing Enter did nothing. A form submits on Enter only when it has a submit
        button or a single input; this has two inputs and its button lives in the footer, outside
        the form — so the most natural thing anybody does with a password field was silently inert.
      -->
      <form v-else id="auth-form" class="body" @submit.prevent="submit">
        <template v-if="needsEmail">
          <label class="lbl" for="auth-email">EMAIL</label>
          <input
            id="auth-email"
            ref="emailField"
            v-model="email"
            class="input"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
          />
        </template>

        <template v-if="mode === 'signup'">
          <label class="lbl spaced" for="auth-name">DISPLAY NAME</label>
          <input
            id="auth-name"
            v-model="displayName"
            class="input"
            type="text"
            autocomplete="nickname"
            placeholder="What other people will call you"
          />
          <p v-if="nameState === 'taken'" class="namesaid bad">
            That name is taken. Pick another, or we’ll make you <strong>{{ suggestion }}</strong>.
            <button type="button" class="linkbtn inline" @click="displayName = suggestion">Use it</button>
          </p>
          <p v-else-if="nameState === 'free'" class="namesaid ok">That name is free.</p>
          <p v-else class="namesaid">This is how people find you when they share a project.</p>
        </template>

        <template v-if="needsPassword">
          <label class="lbl" :class="{ spaced: needsEmail }" for="auth-password">
            {{ mode === 'reset' ? 'NEW PASSWORD' : 'PASSWORD' }}
          </label>
          <div class="pw">
            <input
              id="auth-password"
              ref="passwordField"
              v-model="password"
              class="input"
              :type="showPassword ? 'text' : 'password'"
              :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
              :placeholder="passwordHint"
            />
            <PasswordEye :shown="showPassword" @toggle="showPassword = !showPassword" />
          </div>
        </template>

        <template v-if="mode === 'signup'">
          <label class="lbl spaced" for="auth-password-confirm">CONFIRM PASSWORD</label>
          <input
            id="auth-password-confirm"
            v-model="confirmPassword"
            class="input"
            :class="{ bad: passwordsDiffer }"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="Type it again"
            :aria-invalid="passwordsDiffer"
            aria-describedby="auth-confirm-said"
          />
          <p v-if="passwordsDiffer" id="auth-confirm-said" class="namesaid bad">Passwords don’t match.</p>
        </template>

        <button v-if="mode === 'signin'" type="button" class="linkbtn" @click="mode = 'forgot'">
          Forgotten your password?
        </button>

        <!-- role=alert so a screen reader hears the failure; it replaces nothing, so the form stays
             filled in and the user can correct one field rather than retyping both -->
        <p v-if="hint && !error" class="hint" role="status">{{ hint }}</p>
        <p v-if="error" class="err" role="alert">{{ error }}</p>
      </form>

      <footer class="foot">
        <p v-if="!sent" class="swap">
          <template v-if="mode === 'signin'">
            No account? <button type="button" class="linkbtn" @click="mode = 'signup'">Create one</button>
          </template>
          <template v-else-if="mode === 'signup'">
            Already have one? <button type="button" class="linkbtn" @click="mode = 'signin'">Sign in</button>
          </template>
          <template v-else-if="mode === 'forgot'">
            <button type="button" class="linkbtn" @click="mode = 'signin'">Back to sign in</button>
          </template>
        </p>
        <div class="spacer" />
        <BaseButton v-if="mode !== 'reset'" variant="ghost" @click="emit('close')">
          {{ sent ? 'Close' : 'Not now' }}
        </BaseButton>
        <!--
          `form` + `type="submit"` is what makes Enter in either field do this, and there is
          deliberately no `@click`: with both, a click would fire the handler AND submit the form,
          running the sign-in twice.
        -->
        <BaseButton
          v-if="!sent"
          form="auth-form"
          type="submit"
          variant="primary"
          :disabled="!canSubmit"
          :loading="busy"
        >
          {{ copy.action }}
        </BaseButton>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* the same shell as NewPageDialog and TitlePromptDialog — one dialog system, not three */
.scrim { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; background: var(--scrim); backdrop-filter: blur(3px); padding: 24px; }
.dialog { inline-size: min(420px, 100%); background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-modal); box-shadow: var(--sh-modal); }

.head { position: relative; padding: 24px 52px 4px 26px; }
.x { position: absolute; inset-block-start: 16px; inset-inline-end: 14px; inline-size: 32px; block-size: 32px; display: grid; place-items: center; border: none; border-radius: var(--r-control); background: none; color: var(--ink-faint); cursor: pointer; }
.x:hover { background: var(--surface-muted); color: var(--ink-body); }
.x:focus-visible { outline: 2px solid var(--accent); }
.head h2 { font: 800 19px var(--font-ui); color: var(--ink); margin: 0; }
.head p { font: 400 12.5px/1.6 var(--font-ui); color: var(--ink-muted); margin: 6px 0 0; }

.body { padding: 18px 26px 4px; }
.lbl { display: block; font: 700 10px var(--font-ui); letter-spacing: 0.5px; color: var(--ink-faint); margin-bottom: 8px; }
.lbl.spaced { margin-top: 14px; }
.input {
  inline-size: 100%; padding: 11px 13px;
  border: 1.5px solid var(--border-strong); border-radius: var(--r-control);
  background: var(--surface-sunken); color: var(--ink-body);
  font: 600 14px var(--font-ui), system-ui, sans-serif;
}
.input::placeholder { color: var(--ink-ghost); font-weight: 500; }
.input:focus { outline: none; border-color: var(--accent); background: var(--surface); }
.input.bad { border-color: var(--danger); }

.pw { position: relative; }
.pw .input { padding-inline-end: 46px; }

.linkbtn { border: none; background: none; cursor: pointer; padding: 0; font: 600 11.5px var(--font-ui); color: var(--accent); }
.linkbtn:hover { color: var(--accent-deep); text-decoration: underline; }
.body > .linkbtn { margin-top: 10px; }
.namesaid { margin: 7px 0 0; font: 500 11.5px/1.5 var(--font-ui); color: var(--ink-faint); }
.namesaid.bad { color: var(--danger); }
.namesaid.ok { color: var(--success-deep, var(--accent-deep)); }
.linkbtn.inline { font-size: 11.5px; margin-inline-start: 4px; }

.hint { font: 500 12px/1.5 var(--font-ui); color: var(--ink-body); background: color-mix(in srgb, var(--accent) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); border-radius: var(--r-control); padding: 8px 10px; margin: 14px 0 0; }
.err { font: 500 12px/1.5 var(--font-ui); color: var(--danger-deep); background: var(--danger-tint); border: 1px solid var(--danger-tint-border); border-radius: var(--r-control); padding: 8px 10px; margin: 14px 0 0; }
.sent p { font: 400 13px/1.65 var(--font-ui); color: var(--ink-secondary); margin: 0; }
.sent strong { color: var(--ink-body); font-weight: 700; }

.foot { display: flex; align-items: center; gap: 8px; padding: 20px 26px 24px; }
.swap { font: 500 11.5px var(--font-ui); color: var(--ink-faint); margin: 0; }
.spacer { flex: 1; }

@media (max-width: 900px) {
  .scrim { padding: 12px; align-items: end; }
  .head { padding: 20px 18px 4px; }
  .head h2 { font-size: 17px; }
  .body { padding: 16px 18px 4px; }
  .foot { flex-wrap: wrap; padding: 16px 18px calc(20px + env(safe-area-inset-bottom)); }
  .swap { inline-size: 100%; margin-bottom: 4px; }
  .spacer { display: none; }
  .foot :deep(button) { flex: 1; justify-content: center; }
}
</style>
