<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import { api, setSession } from '../api.js';
import { randomQuote } from '../quotes.js';

const router = useRouter();
const expired = useRoute().query.expired;
const quote = randomQuote();

const email = ref('admin@manzili.property');
const password = ref('manzili254');
const showPassword = ref(false);
const error = ref(expired ? 'Your session ended. Please sign in again.' : '');
const busy = ref(false);
const showPrivacy = ref(false);
const showRegister = ref(false);
const registerName = ref('');
const registerEmail = ref('');
const registerPassword = ref('');
const registerError = ref('');
const registerBusy = ref(false);
const countdown = ref(15);
const policyRead = ref(false);
let countdownTimer = null;

const canSignIn = computed(() => policyRead.value && !busy.value && countdown.value <= 0);

function startCountdown() {
  countdown.value = 15;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0) {
      clearInterval(countdownTimer);
      countdown.value = 0;
    }
  }, 1000);
}

function openPrivacyPolicy() {
  showPrivacy.value = true;
  if (!policyRead.value) startCountdown();
}

function acceptPrivacyPolicy() {
  policyRead.value = true;
  showPrivacy.value = false;
  clearInterval(countdownTimer);
  countdown.value = 0;
}

function openRegister() {
  showRegister.value = true;
  registerError.value = '';
}

function closeRegister() {
  showRegister.value = false;
  registerError.value = '';
  registerName.value = '';
  registerEmail.value = '';
  registerPassword.value = '';
}

async function submitRegister() {
  const fullName = registerName.value.trim();
  const emailAddress = registerEmail.value.trim();
  const newPassword = registerPassword.value;

  if (!fullName || !emailAddress || !newPassword) {
    registerError.value = 'Please fill in your name, email and password.';
    return;
  }
  if (newPassword.length < 8) {
    registerError.value = 'Choose a password with at least 8 characters.';
    return;
  }

  registerBusy.value = true;
  registerError.value = '';
  try {
    const { token, user } = await api('/auth/register', { method: 'POST', body: { full_name: fullName, email: emailAddress, password: newPassword } });
    setSession(token, user);
    closeRegister();
    router.push('/');
  } catch (e) {
    registerError.value = e.message;
  } finally {
    registerBusy.value = false;
  }
}

onMounted(() => {
  const username = 'admin@manzili.property';
  const pass = 'manzili254';
  email.value = username;
  password.value = pass;
});

onBeforeUnmount(() => clearInterval(countdownTimer));

async function submit() {
  if (!email.value || !password.value) {
    error.value = 'Please enter your email and password.';
    return;
  }
  if (!policyRead.value) {
    error.value = 'Please read and accept the privacy policy before signing in.';
    openPrivacyPolicy();
    return;
  }
  if (countdown.value > 0) {
    error.value = `Please wait ${countdown.value} second${countdown.value === 1 ? '' : 's'} before signing in.`;
    return;
  }
  error.value = '';
  busy.value = true;
  try {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
    setSession(token, user);
    router.push('/');
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="card login-card">
      <h1 class="script-title">Manzili Mkononi</h1>
      <blockquote class="quote">
        &ldquo;{{ quote.text }}&rdquo;
        <cite>{{ quote.by }}</cite>
      </blockquote>

      <div v-if="error" class="banner error" role="alert">{{ error }}</div>
      <label class="field">Email
        <input v-model="email" type="email" autocomplete="username" placeholder="you@example.com" @keyup.enter="submit" />
      </label>
      <label class="field">Password
        <span class="input-wrap" style="display: block">
          <input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="Your password" @keyup.enter="submit" />
          <button type="button" class="eye" :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword" @click="showPassword = !showPassword">
            <Icon :name="showPassword ? 'eyeoff' : 'eye'" :size="20" />
          </button>
        </span>
      </label>

      <div style="display: flex; gap: 8px; margin-bottom: 12px;">
        <button type="button" class="btn sm" style="flex: 1" @click="openPrivacyPolicy">Privacy policy</button>
        <button type="button" class="btn sm" style="flex: none; width: 42px;" aria-label="Create landlord account" title="Create landlord account" @click="openRegister">+</button>
      </div>
      <button class="btn primary block" :class="{ busy }" :disabled="!canSignIn" @click="submit">
        {{ countdown > 0 ? `Wait ${countdown}s` : 'Sign in' }}
      </button>
    </div>
  </div>

  <Modal v-if="showRegister" title="Create landlord account" @close="closeRegister">
    <div class="modal-copy">
      <p>Create a separate landlord account to keep your property portfolio and tenant records private.</p>
      <label class="field">Full name
        <input v-model="registerName" type="text" autocomplete="name" placeholder="Your full name" @keyup.enter="submitRegister" />
      </label>
      <label class="field">Email
        <input v-model="registerEmail" type="email" autocomplete="email" placeholder="you@example.com" @keyup.enter="submitRegister" />
      </label>
      <label class="field">Password
        <input v-model="registerPassword" type="password" autocomplete="new-password" placeholder="At least 8 characters" @keyup.enter="submitRegister" />
      </label>
      <p v-if="registerError" class="banner error" role="alert">{{ registerError }}</p>
    </div>
    <footer>
      <button class="btn" @click="closeRegister">Cancel</button>
      <button class="btn primary" :disabled="registerBusy" @click="submitRegister">
        {{ registerBusy ? 'Creating...' : 'Create account' }}
      </button>
    </footer>
  </Modal>

  <Modal v-if="showPrivacy" title="Privacy Policy" @close="showPrivacy = false">
    <div class="modal-copy">
      <p><strong>Manzili Mkononi Privacy Policy</strong></p>
      <p>We collect and use your account details, property information, tenant records, and payment data only to manage rent collection, tenancy records, and property administration.</p>
      <p>Personal information is kept confidential and is used strictly for operating the property management system, sending payment reminders, and maintaining legal and financial records.</p>
      <p>Access is restricted to authorised staff members. We do not sell or share tenant personal information with third parties except where required by law or payment processing obligations.</p>
      <p>By continuing, you confirm that you have read this notice and agree to the processing of data required to operate the system.</p>
    </div>
    <footer>
      <button class="btn" @click="showPrivacy = false">Close</button>
      <button class="btn primary" :disabled="countdown > 0" @click="acceptPrivacyPolicy">I have read and accept</button>
    </footer>
  </Modal>
</template>
