# Docker 镜像发布指南

每次更新代码后，按以下步骤发布新版本镜像到 Docker Hub。

## 前置准备（仅首次）

### 1. 创建 Docker Hub Access Token

登录 [Docker Hub](https://hub.docker.com) → 右上角头像 → Account Settings → Security → New Access Token，复制保存。

### 2. 配置 GitHub Secrets

仓库页面 → Settings → Secrets and variables → Actions → New repository secret，添加：

| Name | Value |
|------|-------|
| `DOCKERHUB_USERNAME` | `wangbinlml` |
| `DOCKERHUB_TOKEN` | 上一步创建的 token |

> 配置一次即可，后续更新无需重复。

## 发布流程

### 1. 确认代码已提交

```bash
git status   # 确认无未提交的改动
```

### 2. 更新版本号（重要，勿漏）

修改 `server/package.json` 的 `version` 字段，与即将打的 tag 保持一致（页面侧边栏显示的版本号来自这里）：

```json
"version": "0.2.2",
```

```bash
git add server/package.json
git commit -m "chore: bump version to 0.2.2"
```

### 3. 打 tag 触发发布

```bash
git tag v0.2.2                # 版本号与上一步 package.json 一致
git push origin main --tags   # 推送 tag 触发自动构建
```
#### 3.1. 提交后删除远端 tag 重新打（会重新构建并覆盖 v0.2.1 镜像，Release 也会重建）
```bash
git push origin :refs/tags/v0.2.1   # 删远端 tag（Release 会保留）
git tag -d v0.2.1 && git tag v0.2.1
git push origin v0.2.1
```

#### 3.2. 查看构建进度

- GitHub 仓库 → Actions 页面，查看 `Publish Docker Image` 工作流状态
- 构建约 10-15 分钟（amd64 + arm64 双架构）
- 构建完成后镜像自动出现在 https://hub.docker.com/repositories/wangbinlml
- **GitHub Release 自动创建**：镜像推送成功后，工作流会基于 tag 自动创建 Release，更新日志由 GitHub 从 commit 记录自动生成，并附上拉取命令。可在仓库 Releases 页面查看或编辑补充说明

### 4. 验证

```bash
docker pull wangbinlml/acme-manager:v0.2.1
```

## 版本号规则

- `v0.2.0`、`v0.2.1`、`v0.3.0` …
- 每次打 tag 会同时推送两个标签：
  - `latest`（最新版本，docker compose up -d 默认拉取）
  - `v0.2.1`（具体版本，可回滚指定版本）

## 回滚到旧版本

修改 `docker-compose.yml` 中的 image tag：

```yaml
image: wangbinlml/acme-manager:v0.2.0   # 指定旧版本
```

然后：

```bash
docker compose down
docker compose up -d
```

## 手动触发（不打 tag）

GitHub 仓库 → Actions → `Publish Docker Image` → Run workflow，可直接从 main 分支手动构建。

## 工作流文件位置

```
.github/workflows/docker-publish.yml
```

触发条件：推送 `v*` 开头的 tag，或手动 dispatch。
