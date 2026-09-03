import { ref } from 'vue';
import { api } from './api';

/** 全局共享的应用版本号，来自公开的 /api/health，登录页也可用 */
export const appVersion = ref('');

let loaded = false;

/** 加载一次即可；失败静默（版本号仅装饰性信息） */
export async function loadVersion(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const res = await api.health();
    appVersion.value = res.version;
  } catch {
    // 忽略
  }
}
