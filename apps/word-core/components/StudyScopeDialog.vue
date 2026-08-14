<template>
  <div class="scope-overlay" @click.self="$emit('cancel')">
    <div class="scope-dialog">
      <h3>选择学习范围</h3>
      <button class="scope-btn primary" @click="$emit('choose', 'page')">仅学习当前页</button>
      <button v-if="page > 1" class="scope-btn" @click="$emit('choose', 'pageAfter')">从当前页学到最后</button>
      <button class="scope-btn" @click="$emit('choose', 'all')">学习当前筛选的全部（{{ total }} 词）</button>
      <div class="scope-footer">
        <button class="cancel-btn" @click="$emit('cancel')">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ total: number
  page?: number
}>()
defineEmits<{
  (e: 'choose', scope: 'page' | 'pageAfter' | 'all'): void
  (e: 'cancel'): void
}>()
</script>

<style lang="scss" scoped>
.scope-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.scope-dialog {
  background: #fff;
  border-radius: 14px;
  padding: 28px 30px 18px;
  width: min(520px, 92vw);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);

  h3 { font-size: 20px; margin-bottom: 20px; color: #1a1a1a; }
}

.scope-btn {
  display: block;
  width: 100%;
  padding: 14px;
  margin-bottom: 12px;
  border: 1px solid #333;
  border-radius: 8px;
  background: color-mix(in srgb, var(--r-accent, #8a4b3a) 5%, var(--r-paper, #fff));
  font-size: 15px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover { background: color-mix(in srgb, var(--r-accent, #8a4b3a) 13%, var(--r-paper, #fff)); border-color: color-mix(in srgb, var(--r-accent, #8a4b3a) 42%, transparent); }
  &.primary {
    background: #e0805e;
    border-color: #e0805e;
    color: #fff;
    &:hover { background: #d06f4d; }
  }
}

.scope-footer {
  text-align: right;
  .cancel-btn {
    border: none;
    background: none;
    font-size: 14px;
    color: #333;
    cursor: pointer;
    padding: 8px 4px;
    &:hover { text-decoration: underline; }
  }
}
</style>
