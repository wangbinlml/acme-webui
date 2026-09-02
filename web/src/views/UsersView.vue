<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { UserView } from '../types';
import { currentUser } from '../auth';
import { errMessage, formatDate } from '../utils';

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
    ElMessage.success('用户已创建');
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
    ElMessage.success(`已将 ${row.username} 的角色改为${role === 'admin' ? '管理员' : '只读'}`);
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
    ElMessage.success(`已重置 ${resetTarget.value.username} 的密码`);
    resetVisible.value = false;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    resetting.value = false;
  }
}

async function remove(row: UserView): Promise<void> {
  await ElMessageBox.confirm(
    `删除用户「${row.username}」？该账号会立即下线。`,
    '删除用户',
    { type: 'error', confirmButtonText: '删除' },
  );
  try {
    await api.deleteUser(row.id);
    ElMessage.success('已删除');
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
        <span>用户</span>
        <el-button type="primary" icon="Plus" @click="openCreate">添加用户</el-button>
      </div>
    </template>
    <el-table v-loading="loading" :data="users">
      <el-table-column label="用户名" min-width="180">
        <template #default="{ row }">
          {{ row.username }}
          <el-tag v-if="row.id === currentUser?.id" size="small" class="self-tag">当前登录</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="角色" width="200">
        <template #default="{ row }">
          <el-select
            :model-value="row.role"
            :disabled="row.id === currentUser?.id"
            style="width: 140px"
            @change="(role: string) => changeRole(row, role)"
          >
            <el-option label="管理员" value="admin" />
            <el-option label="只读（viewer）" value="viewer" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" min-width="180">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openReset(row)">重置密码</el-button>
          <el-button link type="danger" size="small" :disabled="row.id === currentUser?.id" @click="remove(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="添加用户" width="440px">
      <el-form label-width="90px" label-position="left">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" placeholder="2-32 个字符" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="form.password" type="password" show-password placeholder="6-128 位" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="form.role">
            <el-radio value="viewer">只读（viewer）</el-radio>
            <el-radio value="admin">管理员</el-radio>
          </el-radio-group>
          <div class="form-tip">只读用户可查看全部页面，但不能创建 / 续期 / 删除 / 修改配置</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetVisible" :title="`重置 ${resetTarget?.username ?? ''} 的密码`" width="400px">
      <el-input v-model="resetPassword" type="password" show-password placeholder="新密码（6-128 位）" @keyup.enter="submitReset" />
      <div class="form-tip">重置后该用户的所有登录会话会立即下线</div>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="resetting" @click="submitReset">重置</el-button>
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
  color: #909399;
  line-height: 1.6;
  width: 100%;
}
</style>
