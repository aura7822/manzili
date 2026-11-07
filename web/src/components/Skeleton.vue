<script setup>
defineProps({
  type: { type: String, default: 'table' }, // table | cards | list | bento
  rows: { type: Number, default: 6 },
  cols: { type: Number, default: 6 },
});
</script>

<template>
  <div v-if="type === 'bento'" class="bento" aria-busy="true" aria-label="Loading">
    <div class="tile s5"><div class="sk" style="width: 40%; height: 12px" /><div class="sk" style="width: 70%; height: 34px; margin-top: 16px" /><div class="sk" style="width: 55%; height: 10px; margin-top: 14px" /></div>
    <div class="tile s3"><div class="sk" style="width: 55%; height: 12px" /><div class="sk" style="width: 75%; height: 28px; margin-top: 16px" /></div>
    <div class="tile s4"><div class="sk" style="width: 55%; height: 12px" /><div class="sk" style="width: 75%; height: 28px; margin-top: 16px" /></div>
    <div v-for="n in 4" :key="n" class="tile s3"><div class="sk" style="width: 50%; height: 12px" /><div class="sk" style="width: 65%; height: 26px; margin-top: 16px" /></div>
    <div class="tile s7" style="min-height: 250px"><div class="sk" style="width: 35%; height: 12px" /><div class="sk" style="width: 100%; height: 160px; margin-top: 18px" /></div>
    <div class="tile s5" style="min-height: 250px"><div class="sk" style="width: 35%; height: 12px" /><div v-for="n in 4" :key="n" class="sk-row"><div class="sk" style="width: 40px; height: 40px" /><div style="flex: 1"><div class="sk" style="width: 75%; height: 12px" /><div class="sk" style="width: 45%; height: 10px; margin-top: 8px" /></div></div></div>
  </div>

  <div v-else-if="type === 'cards'" class="bento" aria-busy="true" aria-label="Loading">
    <div v-for="n in rows" :key="n" class="tile s4"><div class="sk" style="width: 55%; height: 12px" /><div class="sk" style="width: 75%; height: 28px; margin-top: 16px" /></div>
  </div>

  <div v-else-if="type === 'list'" aria-busy="true" aria-label="Loading">
    <div v-for="n in rows" :key="n" class="sk-row">
      <div class="sk" style="width: 40px; height: 40px" />
      <div style="flex: 1"><div class="sk" style="width: 70%; height: 12px" /><div class="sk" style="width: 40%; height: 10px; margin-top: 8px" /></div>
    </div>
  </div>

  <div v-else class="table-wrap" aria-busy="true" aria-label="Loading">
    <table>
      <thead><tr><th v-for="c in cols" :key="c"><div class="sk" style="width: 60%; height: 10px" /></th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r"><td v-for="c in cols" :key="c"><div class="sk" :style="{ width: 45 + ((r * 7 + c * 13) % 40) + '%', height: '12px' }" /></td></tr>
      </tbody>
    </table>
  </div>
</template>
