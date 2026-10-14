<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { errMessage } from '../utils';

const router = useRouter();
const submitting = ref(false);
const fullchain = ref('');
const privkey = ref('');
const autoRenew = ref(false);
const renewBeforeDays = ref(30);

async function onFullchainFile(file: File): Promise<void> {
  fullchain.value = await file.text();
}

async function onPrivkeyFile(file: File): Promise<void> {
  privkey.value = await file.text();
}

async function submit(): Promise<void> {
  if (!fullchain.value.trim() || !privkey.value.trim()) {
    ElMessage.error('请提供 fullchain 和 privkey PEM 内容');
    return;
  }
  if (!fullchain.value.includes('BEGIN CERTIFICATE')) {
    ElMessage.error('fullchain 内容需包含 BEGIN CERTIFICATE');
    return;
  }
  if (!privkey.value.includes('PRIVATE KEY')) {
    ElMessage.error('privkey 内容需包含 PRIVATE KEY');
    return;
  }

  submitting.value = true;
  try {
    const res = await api.importCert({
      fullchain: fullchain.value.trim(),
      privkey: privkey.value.trim(),
      autoRenew: autoRenew.value,
      renewBeforeDays: renewBeforeDays.value,
    });
    ElMessage.success(`导入成功：${res.certificate.primaryDomain}`);
    router.push(`/certificates/${res.certificate.id}`);
  } catch (e) {
    ElMessage.error(errMessage(e));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-row justify="center">
    <el-col :span="14">
      <el-card shadow="never">
        <template #header>导入 SSL 证书</template>
        <el-form label-width="110px" label-position="left">
          <el-form-item label="证书内容" required>
            <div class="upload-row">
              <el-input
                v-model="fullchain"
                type="textarea"
                :rows="6"
                placeholder="粘贴 fullchain.pem 内容，或点击右侧按钮选择文件"
              />
              <el-upload
                :show-file-list="false"
                :before-upload="(f: File) => { onFullchainFile(f); return false; }"
                accept=".pem,.crt,.txt"
              >
                <el-button size="small">选择文件</el-button>
              </el-upload>
            </div>
          </el-form-item>
          <el-form-item label="私钥" required>
            <div class="upload-row">
              <el-input
                v-model="privkey"
                type="textarea"
                :rows="6"
                placeholder="粘贴 privkey.pem 内容，或点击右侧按钮选择文件"
              />
              <el-upload
                :show-file-list="false"
                :before-upload="(f: File) => { onPrivkeyFile(f); return false; }"
                accept=".pem,.key,.txt"
              >
                <el-button size="small">选择文件</el-button>
              </el-upload>
            </div>
          </el-form-item>
          <el-form-item label="自动续期">
            <el-switch v-model="autoRenew" />
            <span class="form-tip inline">导入的证书通常无法通过 acme.sh 续期，建议关闭</span>
          </el-form-item>
          <el-form-item v-if="autoRenew" label="续期阈值">
            <el-input-number v-model="renewBeforeDays" :min="1" :max="89" />
            <span class="form-tip inline">天前触发</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="submit">导入证书</el-button>
            <el-button @click="router.push('/certificates')">取消</el-button>
          </el-form-item>
        </el-form>
        <el-alert type="info" :closable="false" style="margin-top: 8px">
          <ul class="help-list">
            <li>支持导入由其他工具签发的证书（商业 CA、其他 acme.sh 实例等）</li>
            <li>fullchain 需包含完整证书链（域名证书 + 中间证书）</li>
            <li>导入后证书同样可以分发到其他服务器</li>
            <li>导入的证书无法通过本系统续期，到期前请重新导入或创建新证书</li>
          </ul>
        </el-alert>
      </el-card>
    </el-col>
  </el-row>
</template>

<style scoped>
.upload-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.upload-row .el-textarea {
  flex: 1;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
.form-tip.inline {
  margin: 0 8px;
}
.help-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  color: #606266;
  line-height: 1.8;
}
</style>
