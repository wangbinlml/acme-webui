import { ref } from 'vue';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'acme-theme';

/** 全局共享的主题模式 */
export const theme = ref<ThemeMode>('light');

function apply(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

/** 启动时调用一次：localStorage 优先，否则跟随系统偏好 */
export function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY);
  const mode: ThemeMode =
    saved === 'dark' || saved === 'light'
      ? saved
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  theme.value = mode;
  apply(mode);
}

export function setTheme(mode: ThemeMode): void {
  theme.value = mode;
  localStorage.setItem(STORAGE_KEY, mode);
  apply(mode);
}

export function toggleTheme(): void {
  setTheme(theme.value === 'dark' ? 'light' : 'dark');
}
