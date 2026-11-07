<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({
  modelValue: { type: String, default: null }, // null = today
  min: { type: String, required: true }, // earliest selectable day (YYYY-MM-DD)
  max: { type: String, required: true }, // latest selectable day (today)
  disabled: Boolean,
});
const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const root = ref(null);
const parse = (s) => new Date(`${s}T00:00:00`);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const view = ref(parse(props.modelValue ?? props.max));
watch(open, (o) => { if (o) view.value = parse(props.modelValue ?? props.max); });

const monthLabel = computed(() => view.value.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }));
const firstOfView = computed(() => new Date(view.value.getFullYear(), view.value.getMonth(), 1));
const canPrev = computed(() => iso(new Date(firstOfView.value.getFullYear(), firstOfView.value.getMonth(), 0)) >= props.min);
const canNext = computed(() => iso(new Date(firstOfView.value.getFullYear(), firstOfView.value.getMonth() + 1, 1)) <= props.max);

const days = computed(() => {
  const first = firstOfView.value;
  const lead = (first.getDay() + 6) % 7; // week starts on Monday
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) {
    const date = iso(new Date(first.getFullYear(), first.getMonth(), d));
    cells.push({ d, date, disabled: date < props.min || date > props.max });
  }
  return cells;
});

const shift = (n) => { view.value = new Date(firstOfView.value.getFullYear(), firstOfView.value.getMonth() + n, 1); };

function pick(date) {
  emit('update:modelValue', date === props.max ? null : date);
  open.value = false;
}

const label = computed(() =>
  props.modelValue ? parse(props.modelValue).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : 'Today');

const onDoc = (e) => { if (open.value && root.value && !root.value.contains(e.target)) open.value = false; };
const onKey = (e) => { if (e.key === 'Escape') open.value = false; };
onMounted(() => { document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); });
</script>

<template>
  <div ref="root" class="cal-wrap">
    <button class="btn" :class="{ primary: modelValue }" :disabled="disabled" aria-haspopup="dialog" :aria-expanded="open" aria-label="Choose a date" @click="open = !open">
      <Icon name="calendar" :size="18" /><span>{{ label }}</span>
    </button>
    <template v-if="open">
      <div class="cal-backdrop" @click="open = false" />
      <div class="cal-pop" role="dialog" aria-label="Calendar">
        <div class="cal-head">
          <button class="btn sm icon-btn" :disabled="!canPrev" aria-label="Previous month" @click="shift(-1)"><Icon name="left" :size="16" /></button>
          <span>{{ monthLabel }}</span>
          <button class="btn sm icon-btn" :disabled="!canNext" aria-label="Next month" @click="shift(1)"><Icon name="right" :size="16" /></button>
        </div>
        <div class="cal-grid">
          <div v-for="d in ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']" :key="d" class="cal-dow">{{ d }}</div>
          <template v-for="(c, i) in days" :key="i">
            <span v-if="!c" class="cal-day blank" />
            <button v-else class="cal-day" :class="{ today: c.date === max, selected: c.date === (modelValue ?? max) }"
                    :disabled="c.disabled" :aria-label="c.date" :aria-pressed="c.date === (modelValue ?? max)" @click="pick(c.date)">{{ c.d }}</button>
          </template>
        </div>
        <div class="cal-foot">
          <small class="muted">View the system as it was up to 2 weeks ago.</small>
          <button class="btn sm" @click="pick(max)">Today</button>
        </div>
      </div>
    </template>
  </div>
</template>
