import { ref } from 'vue';
import { api } from './api';
import type { AuthUser } from './types';

/** 当前登录用户（null 未登录）；路由守卫首次跳转时填充 */
export const currentUser = ref<AuthUser | null>(null);
export const authChecked = ref(false);

export async function fetchMe(): Promise<void> {
  try {
    currentUser.value = (await api.me()).user;
  } catch {
    currentUser.value = null;
  }
  authChecked.value = true;
}

/** viewer 只读：所有写操作按钮以此控制显隐（服务端另有强制校验） */
export function canWrite(): boolean {
  return currentUser.value?.role === 'admin';
}
