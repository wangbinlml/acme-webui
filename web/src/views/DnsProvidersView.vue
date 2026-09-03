<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { DnsProviderView, ProviderTypeDef } from '../types';
import { canWrite } from '../auth';
import { errMessage, formatDate } from '../utils';

const providers = ref<DnsProviderView[]>([]);
const types = ref<ProviderTypeDef[]>([]);
const loading = ref(true);

const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const submitting = ref(false);
const testing = ref(false);

const form = reactive({
  name: '',
  type: 'cloudflare',
  credentials: {} as Record<string, string>,
});

const activeType = computed(() => types.value.find((t) => t.id === form.type));

watch(
  () => form.type,
  () => {
    form.credentials = {};
  },
);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    providers.value = (await api.listProviders()).providers;
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    types.value = (await api.providerTypes()).types;
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
  await refresh();
});

function openCreate(): void {
  editingId.value = null;
  form.name = '';
  form.type = 'cloudflare';
  form.credentials = {};
  dialogVisible.value = true;
}

function openEdit(row: DnsProviderView): void {
  editingId.value = row.id;
  form.name = row.name;
  form.type = row.type;
  form.credentials = { ...row.credentials };
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.error('请填写名称');
    return;
  }
  submitting.value = true;
  try {
    if (editingId.value) {
      await api.updateProvider(editingId.value, { name: form.name, credentials: form.credentials });
      ElMessage.success('已保存');
    } else {
      await api.createProvider({ name: form.name, type: form.type, credentials: form.credentials });
      ElMessage.success('已添加');
    }
    dialogVisible.value = false;
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    submitting.value = false;
  }
}

async function testDialog(): Promise<void> {
  testing.value = true;
  try {
    const res = await api.testProvider({ type: form.type, credentials: form.credentials });
    res.ok ? ElMessage.success(res.message) : ElMessage.error(res.message);
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    testing.value = false;
  }
}

async function testRow(row: DnsProviderView): Promise<void> {
  try {
    const res = await api.testProvider({ providerId: row.id });
    res.ok ? ElMessage.success(res.message) : ElMessage.error(res.message);
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

async function remove(row: DnsProviderView): Promise<void> {
  await ElMessageBox.confirm(`删除 DNS Provider「${row.name}」？`, '删除', { type: 'warning' });
  try {
    await api.deleteProvider(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (e) {
    ElMessage.error(errMessage(e));
  }
}

function credentialEntries(row: DnsProviderView): string[] {
  const fields = types.value.find((t) => t.id === row.type)?.fields ?? [];
  return Object.entries(row.credentials).map(([k, v]) => {
    const label = fields.find((f) => f.key === k)?.label ?? k;
    return `${label}: ${v || '（未设置）'}`;
  });
}
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>DNS Providers</span>
        <el-button v-if="canWrite()" type="primary" icon="Plus" @click="openCreate">添加</el-button>
      </div>
    </template>
    <el-table v-loading="loading" :data="providers">
      <el-table-column label="名称" min-width="140">
        <template #default="{ row }">{{ row.name }}</template>
      </el-table-column>
      <el-table-column label="类型" width="140">
        <template #default="{ row }">{{ row.typeName }}</template>
      </el-table-column>
      <el-table-column label="凭据" min-width="260">
        <template #default="{ row }">
          <div v-for="line in credentialEntries(row)" :key="line" class="cred-line">{{ line }}</div>
        </template>
      </el-table-column>
      <el-table-column label="添加时间" width="160">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="canWrite()"
            link
            type="primary"
            size="small"
            :disabled="!row.testable"
            @click="testRow(row)"
          >
            测试连接
          </el-button>
          <el-button v-if="canWrite()" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="canWrite()" link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="还没有 DNS Provider">
          <el-button v-if="canWrite()" type="primary" @click="openCreate">添加</el-button>
        </el-empty>
      </template>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑 DNS Provider' : '添加 DNS Provider'"
      width="520px"
    >
      <el-form label-width="110px" label-position="left">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="例如：CF 主账号" />
        </el-form-item>
        <el-form-item label="Provider" required>
          <el-select v-model="form.type" :disabled="!!editingId" style="width: 100%">
            <el-option v-for="t in types" :key="t.id" :label="t.label" :value="t.id" />
          </el-select>
          <div v-if="editingId" class="form-tip">不支持修改类型，如需更改请删除后重新添加</div>
        </el-form-item>
        <el-form-item v-if="activeType?.helpUrl" label=" ">
          <el-alert type="info" :closable="false" class="help-alert">
            <div class="help-line">
              <span>{{ activeType.helpText }}</span>
              <el-link type="primary" :href="activeType.helpUrl" target="_blank" class="help-link">
                打开控制台获取 <el-icon><TopRight /></el-icon>
              </el-link>
            </div>
          </el-alert>
        </el-form-item>
        <el-form-item
          v-for="field in activeType?.fields ?? []"
          :key="field.key"
          :label="field.label"
          :required="field.required"
        >
          <el-input
            v-model="form.credentials[field.key]"
            :show-password="field.secret"
            :placeholder="field.placeholder ?? (field.required ? '必填' : '可选')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="activeType?.testable" :loading="testing" @click="testDialog">测试连接</el-button>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
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
.cred-line {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
  word-break: break-all;
}
.form-tip {
  font-size: 12px;
  color: #909399;
}
.help-alert {
  width: 100%;
  margin-top: 4px;
}
.help-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  line-height: 1.6;
}
.help-link {
  flex-shrink: 0;
  font-size: 12px;
}
</style>
