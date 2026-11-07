<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import { api, setSession } from '../api.js';
import { randomQuote } from '../quotes.js';

const router = useRouter();
const expired = useRoute().query.expired;
const quote = randomQuote();

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const error = ref(expired ? 'Your session ended. Please sign in again.' : '');
const busy = ref(false);

async function submit() {
  if (!email.value || !password.value) {
    error.value = 'Please enter your email and password.';
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
      <h1 class="script-title">My Property Management System</h1>
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
      <button class="btn primary block" :class="{ busy }" :disabled="busy" @click="submit">Sign in</button>
    </div>
  </div>
</template>
