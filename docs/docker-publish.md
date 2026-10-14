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

### 2. 打 tag 触发发布

```bash
git add -A
git commit -m "feat: 分发记录/导入/批量操作/吊销/标签/总览页 + Docker 发布配置"
git tag v0.2.0 # 版本号按需递增
git push origin main --tags # 推送 tag 触发自动构建
```

### 3. 查看构建进度

- GitHub 仓库 → Actions 页面，查看 `Publish Docker Image` 工作流状态
- 构建约 10-15 分钟（amd64 + arm64 双架构）
- 构建完成后镜像自动出现在 https://hub.docker.com/r/wangbinlml/acme-manager

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
