# 部署到自己的服务器

`main` 分支每次更新，GitHub Actions（`.github/workflows/deploy.yml`）会构建站点，用 rsync 通过 SSH 上传到服务器，再原子地切换到新版本。这一页说明服务器一次性的准备工作。

## 工作方式

```
/srv/ubot-docs/
├── releases/
│   ├── 3f2a…（完整的 commit sha）/   每次部署一个目录，保留最近 5 个
│   └── 9c1d…/
└── current -> releases/9c1d…          nginx 的 root，部署时原子切换
```

1. 构建：`npm ci`、`npm test`、`npm run check`、`npm run build`，产物在 `dist/`。
2. 上传：`rsync` 到 `releases/<sha>/`。
3. 切换：执行 `activate <sha>`，服务器把 `current` 指向新目录（先建临时链接再 `mv -T`，读者不会看到半个站点），并删除最旧的版本，只留 5 个。

部署密钥只能做这两件事：`deploy/ubot-docs-gate.sh` 作为 `authorized_keys` 的强制命令，拒绝其他一切命令，也拒绝从服务器下载。

## 1. 准备服务器

以下命令以 Debian/Ubuntu 为例，用 root 执行。

```bash
apt install nginx rsync
adduser --system --group --shell /bin/bash --home /home/deploy deploy
mkdir -p /srv/ubot-docs/releases
chown -R deploy:deploy /srv/ubot-docs
install -m 755 ubot-docs-gate.sh /usr/local/bin/ubot-docs-gate   # 来自本仓库的 deploy/
```

`DEPLOY_PATH`（这里是 `/srv/ubot-docs`）不能含空格，并且要和 `authorized_keys` 里写给 gate 的路径一致。

## 2. 生成部署密钥

在自己的电脑上生成一对专用密钥，不要设口令（Actions 无法输入）：

```bash
ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f ubot-docs-deploy
```

把公钥 `ubot-docs-deploy.pub` 的内容加到服务器 `/home/deploy/.ssh/authorized_keys`，前面加上限制：

```
restrict,command="/usr/local/bin/ubot-docs-gate /srv/ubot-docs" ssh-ed25519 AAAA… github-actions-deploy
```

```bash
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /dev/null /home/deploy/.ssh/authorized_keys   # 然后写入上面那一行
```

`restrict` 关闭端口转发、终端和代理转发，`command=` 让这把密钥只能运行 gate。

## 3. 填写 GitHub 的 Secrets

仓库 **Settings → Secrets and variables → Actions**：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `DEPLOY_HOST` | Secret | 服务器的域名或 IP |
| `DEPLOY_PORT` | Secret | SSH 端口，可不填，默认 22 |
| `DEPLOY_USER` | Secret | `deploy` |
| `DEPLOY_PATH` | Secret | `/srv/ubot-docs` |
| `DEPLOY_SSH_KEY` | Secret | 私钥文件 `ubot-docs-deploy` 的全部内容 |
| `DEPLOY_KNOWN_HOSTS` | Secret | 服务器的主机公钥行，见下 |
| `SITE_URL` | Variable | 站点地址，例如 `https://docs.example.com` |

主机公钥要固定下来，工作流不会关闭主机校验。在一台可信的机器上执行：

```bash
ssh-keyscan -p 22 -t ed25519 docs.example.com
```

把输出的一行填进 `DEPLOY_KNOWN_HOSTS`，并和服务器上 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` 的指纹核对一致。

Secrets 没填齐时，部署任务会以提示“Deploy skipped”结束，不算失败。Secrets 填齐而 `SITE_URL` 没填时，部署任务会失败：否则上线的页面会把规范链接（canonical）和站点地图指向 `ubot-docs.example.invalid`。回滚不需要 `SITE_URL`。工作流使用名为 `production` 的 environment，可以在那里加审批人。

## 4. 配置 nginx 和 HTTPS

证书要在 nginx 提供 80 端口之后才能申请，而完整配置里的 443 块又需要证书文件，所以分两步做：先只开 80 端口，拿到证书后再换成完整配置。

**第一步：只开 80 端口，用来申请证书。** 把下面的内容写入 `/etc/nginx/sites-available/ubot-docs`（换成自己的域名）：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name docs.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/acme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/ubot-docs /etc/nginx/sites-enabled/
mkdir -p /var/www/acme
nginx -t && systemctl reload nginx
```

**第二步：申请证书。** 二选一：

```bash
# certbot
apt install certbot
certbot certonly --webroot -w /var/www/acme -d docs.example.com
# acme.sh
acme.sh --issue --webroot /var/www/acme -d docs.example.com
```

**第三步：换成完整配置。** 用 `deploy/nginx.conf.example` 覆盖 `/etc/nginx/sites-available/ubot-docs`，替换域名和路径，并把 `ssl_certificate` 两行改成证书的实际位置：

```bash
nginx -t && systemctl reload nginx
```

配置里已经包含：80 端口跳转到 HTTPS；`root` 指向 `current`；gzip（装了 brotli 模块时取消注释即可启用 brotli）；`/_astro/` 下带哈希的文件缓存一年；HTML 每次都重新验证；`404.html` 作为找不到页面时的返回。

两种证书工具都会自动续期；acme.sh 用 `--install-cert … --reloadcmd "systemctl reload nginx"` 安装证书。

nginx 1.18 及以上都能用这份配置。1.25.1 及以上版本对 `listen … http2` 只给出弃用提示，不影响运行；想消除提示时，去掉 `http2` 参数，在 `listen` 下面单独加一行 `http2 on;`。

> [!IMPORTANT]
> 服务器在中国大陆时，域名必须先完成 ICP 备案，才能在 80/443 端口提供网站服务；未备案的域名会被接入商拦截。备案以服务器所在的云服务商为主体办理，通常需要一到数周。服务器在境外则不需要备案。

## 回滚

服务器上保留最近 5 个版本。两种回滚方式：

- 在 GitHub 的 **Actions → Deploy → Run workflow** 里，把 `release` 填成之前某次部署的完整 commit sha。只切换，不重新构建。
- 直接在服务器上切换：

  ```bash
  cd /srv/ubot-docs
  ls -lt releases/                       # 找到要恢复的版本
  ln -sfn releases/<sha> current.new && mv -Tf current.new current
  ```

切换是原子的，不需要重载 nginx。

## 排查

- `Permission denied (publickey)`：检查 `authorized_keys` 的权限（600）和所有者，以及 `DEPLOY_SSH_KEY` 是否包含完整的私钥（含首尾两行）。
- `Host key verification failed`：`DEPLOY_KNOWN_HOSTS` 与服务器当前的主机密钥不一致。确认服务器没被替换后，重新执行 `ssh-keyscan` 更新。
- `ubot-docs-gate: denied …`：gate 拒绝了这条命令；`DEPLOY_PATH` 要与 `authorized_keys` 里 gate 的参数一致。
