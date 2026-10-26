<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { UserView } from '../types';
import { currentUser } from '../auth';
import { errMessage, formatDate } from '../utils';

const { t } = useI18n();
const users = ref<UserView[]>([]);
const loading = ref(true);

const dialogVisible = ref(false);
const submitting = ref(false);
const form = reactive({ username: '', password: '', role: 'viewer' });

const resetTarget = ref<UserView | null>(null);
const resetVisible = ref(false);
const resetPassword = ref('');
const resetting = ref(false);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    users.value = (await api.listUsers()).users;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

function openCreate(): void {
  form.username = '';
  form.password = '';
  form.role = 'viewer';
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  submitting.value = true;
  try {
    await api.createUser({ username: form.username.trim(), password: form.password, role: form.role });
    ElMessage.success(t('users.userCreated'));
    dialogVisible.value = false;
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    submitting.value = false;
  }
}

async function changeRole(row: UserView, role: string): Promise<void> {
  if (row.id === currentUser.value?.id) return; // 不改自己的角色
  try {
    await api.updateUser(row.id, { role });
    ElMessage.success(
      t('users.roleChanged', { name: row.username, role: role === 'admin' ? t('users.roleAdmin') : t('users.roleViewer') }),
    );
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
    await refresh();
  }
}

function openReset(row: UserView): void {
  resetTarget.value = row;
  resetPassword.value = '';
  resetVisible.value = true;
}

async function submitReset(): Promise<void> {
  if (!resetTarget.value) return;
  resetting.value = true;
  try {
    await api.updateUser(resetTarget.value.id, { password: resetPassword.value });
    ElMessage.success(t('users.pwdReset', { name: resetTarget.value.username }));
    resetVisible.value = false;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    resetting.value = false;
  }
}

async function remove(row: UserView): Promise<void> {
  await ElMessageBox.confirm(
    t('users.deleteConfirm', { name: row.username }),
    t('users.deleteTitle'),
    { type: 'error', confirmButtonText: t('users.delete') },
  );
  try {
    await api.deleteUser(row.id);
    ElMessage.success(t('users.deleted'));
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>{{ t('users.title') }}</span>
        <el-button type="primary" icon="Plus" @click="openCreate">{{ t('users.add') }}</el-button>
      </div>
    </template>
    <el-table v-loading="loading" :data="users">
      <el-table-column :label="t('users.colUsername')" min-width="180">
        <template #default="{ row }">
          {{ row.username }}
          <el-tag v-if="row.id === currentUser?.id" size="small" class="self-tag">{{ t('users.current') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('users.colRole')" width="200">
        <template #default="{ row }">
          <el-select
            :model-value="row.role"
            :disabled="row.id === currentUser?.id"
            style="width: 140px"
            @change="(role: string) => changeRole(row, role)"
          >
            <el-option :label="t('users.roleAdmin')" value="admin" />
            <el-option :label="t('users.roleViewer')" value="viewer" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column :label="t('users.colCreatedAt')" min-width="180">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column :label="t('users.colActions')" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openReset(row)">{{ t('users.resetPwd') }}</el-button>
          <el-button link type="danger" size="small" :disabled="row.id === currentUser?.id" @click="remove(row)">
            {{ t('users.delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="t('users.addTitle')" width="440px">
      <el-form label-width="90px" label-position="left">
        <el-form-item :label="t('users.formUsername')" required>
          <el-input v-model="form.username" :placeholder="t('users.formUsernamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('users.formPassword')" required>
          <el-input v-model="form.password" type="password" show-password :placeholder="t('users.formPasswordPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('users.formRole')">
          <el-radio-group v-model="form.role">
            <el-radio value="viewer">{{ t('users.roleViewer') }}</el-radio>
            <el-radio value="admin">{{ t('users.roleAdmin') }}</el-radio>
          </el-radio-group>
          <div class="form-tip">{{ t('users.roleViewerTip') }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">{{ t('users.createBtn') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetVisible" :title="t('users.resetTitle', { name: resetTarget?.username ?? '' })" width="400px">
      <el-input v-model="resetPassword" type="password" show-password :placeholder="t('users.formPasswordPlaceholder')" @keyup.enter="submitReset" />
      <div class="form-tip">{{ t('users.resetTip') }}</div>
      <template #footer>
        <el-button @click="resetVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="resetting" @click="submitReset">{{ t('users.resetBtn') }}</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.self-tag {
  margin-left: 8px;
}
.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  width: 100%;
}
</style>
