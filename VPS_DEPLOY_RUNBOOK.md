# PodifyAI VPS 部署与运维手册

这份文档面向后续在其他 VPS / EC2 / 云服务器上重复部署 PodifyAI 的场景。内容基于本次实际部署过程整理，不只包含正常操作流程，也包含这次已经踩过并验证过的故障处理办法。

适用环境：
- Ubuntu 22.04 / 24.04
- 单台服务器
- Flask + Gunicorn + Nginx
- SQLite 本地存储
- 域名可选，但正式上线建议一定配 HTTPS

## 1. 部署目标

最终目标是得到这样一套运行状态：
- PodifyAI 代码放在 `/opt/podifyai`
- Python 虚拟环境放在 `/opt/podifyai/.venv`
- Gunicorn 监听 `127.0.0.1:8000`
- Nginx 对外提供 `80/443`
- systemd 接管进程，支持开机自启
- API key 只保存在服务器本地 `.env.local`
- 域名支持 HTTPS

## 2. 推荐部署方式

推荐方式：本地打包上传到服务器，而不是在服务器上直接保存 GitHub 凭证。

原因：
- 更安全，不需要把 GitHub Token 放到服务器
- `.env.local` 可以单独传输，不会混进代码仓库
- 适合本地已经验证通过、准备上线的版本

### 2.1 方式 A：推荐，使用本地打包上传

在本地项目目录执行：

```bash
git archive --format=tar.gz -o podifyai.tar.gz HEAD
scp -i ~/.ssh/your-key.pem podifyai.tar.gz ubuntu@<server-ip>:/tmp/podifyai.tar.gz
scp -i ~/.ssh/your-key.pem .env.local ubuntu@<server-ip>:/tmp/podifyai.env
```

服务器上执行：

```bash
sudo mkdir -p /opt/podifyai
sudo chown $USER:$USER /opt/podifyai

tar -xzf /tmp/podifyai.tar.gz -C /opt/podifyai
mv /tmp/podifyai.env /opt/podifyai/.env.local
chmod 600 /opt/podifyai/.env.local
```

### 2.2 方式 B：直接从 GitHub 拉代码

如果仓库是公开仓库，或你接受在服务器上配置 Git 权限，也可以直接拉：

```bash
sudo mkdir -p /opt/podifyai
sudo chown $USER:$USER /opt/podifyai
cd /opt/podifyai
git clone <your-github-repo-url> .
```

不推荐把长期有效的 GitHub Token 直接写进远程地址。

## 3. 服务器基础准备

```bash
sudo apt update
sudo apt install -y git nginx ffmpeg python3 python3-venv python3-pip certbot python3-certbot-nginx
```

建议同时确认：
- 系统时钟正常
- 服务器磁盘空间足够
- 80 / 443 / 22 端口已经在云平台安全组放行

AWS Security Group 至少要开：
- `22`：SSH
- `80`：HTTP
- `443`：HTTPS

如果 `80` 没放行：
- 域名可能能解析
- 但网站打不开
- Certbot 也可能申请失败

如果 `443` 没放行：
- HTTPS 证书可能已经申请成功
- 但外部浏览器仍然无法打开 `https://...`

## 4. 环境变量与密钥处理

密钥处理原则：
- 只保存在服务器本地 `.env.local`
- 权限设为 `600`
- 不写进 GitHub
- 不把密钥直接拼进命令参数
- 不把 `.env.local` 暴露给 Nginx 或 Web 根目录

建议从 `.env.local.example` 复制：

```bash
cp .env.local.example .env.local
chmod 600 .env.local
```

至少要填写：
- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `OPENAI_API_KEY`
- `OPENAI_API_BASE`
- `SILICONFLOW_API_KEY`
- `SILICONFLOW_API_BASE`

如果启用邮箱、支付，还要补：
- `SENDGRID_*` 或 SMTP 配置
- `STRIPE_*`

### 4.1 HTTP 阶段的推荐写法

如果域名还没接好，或者 HTTPS 还没配好：

```env
ALLOWED_ORIGINS=http://<server-ip>,http://your-domain.com
SESSION_COOKIE_SECURE=false
```

### 4.2 HTTPS 完成后的推荐写法

```env
ALLOWED_ORIGINS=https://your-domain.com
SESSION_COOKIE_SECURE=true
```

如果你还保留 IP 访问，也可以显式加上：

```env
ALLOWED_ORIGINS=http://<server-ip>,https://your-domain.com
SESSION_COOKIE_SECURE=true
```

## 5. Python 环境与依赖安装

```bash
cd /opt/podifyai
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements-ec2.txt
```

生产部署优先使用：
- `requirements-ec2.txt`

说明：
- `requirements-web.txt`：Web 运行依赖
- `requirements-ec2.txt`：服务器部署最小依赖
- `requirements-model.txt`：模型 / 本地推理扩展依赖

## 6. 初始化数据库

### 6.1 只建表

最稳妥的做法是先建表，再手动创建管理员账号：

```bash
cd /opt/podifyai
source .venv/bin/activate
python - <<'PY'
from app import app, db
with app.app_context():
    db.create_all()
    print('DB_READY')
PY
```

### 6.2 创建管理员账号

```bash
cd /opt/podifyai
source .venv/bin/activate
python create_admin_user.py
```

### 6.3 如果想直接用初始化脚本

```bash
cd /opt/podifyai
source .venv/bin/activate
python init_db.py
```

注意：
- `init_db.py` 会创建默认管理员账号
- 默认密码必须立刻修改
- 生产环境更推荐先建表，再通过 `create_admin_user.py` 设置管理员

## 7. 启动前自检

```bash
cd /opt/podifyai
source .venv/bin/activate
python -m py_compile app.py auth.py billing.py content.py decorators.py extensions.py history.py models.py services.py static_routes.py tts.py voices.py wsgi.py gunicorn.conf.py init_db.py
python -X utf8 -m unittest discover -s tests -v
python -X utf8 -c "import app; print('IMPORT_OK')"
```

如果这些都通过，再进入启动阶段。

## 8. Gunicorn 本地试跑

```bash
cd /opt/podifyai
chmod +x deploy/ec2/start.sh
./deploy/ec2/start.sh
```

默认行为：
- Gunicorn 监听 `127.0.0.1:8000`
- 外部用户不会直接访问 Gunicorn
- 由 Nginx 反代到 Gunicorn

如果你只是想快速验证，也可以另开一个 SSH 窗口：

```bash
curl -I http://127.0.0.1:8000/
```

## 9. 配置 systemd

复制示例：

```bash
sudo cp deploy/ec2/podifyai.service.example /etc/systemd/system/podifyai.service
sudo nano /etc/systemd/system/podifyai.service
```

关键字段通常要确认：
- `User`
- `Group`
- `WorkingDirectory`
- `EnvironmentFile`
- `ExecStart`

常见配置参考：

```ini
[Unit]
Description=PodifyAI Web App
After=network.target

[Service]
User=ubuntu
Group=www-data
WorkingDirectory=/opt/podifyai
EnvironmentFile=/opt/podifyai/.env.local
ExecStart=/opt/podifyai/deploy/ec2/start.sh
Restart=always
RestartSec=5
TimeoutStopSec=30
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable podifyai
sudo systemctl start podifyai
sudo systemctl status podifyai --no-pager
```

## 10. 配置 Nginx

### 10.1 HTTP 基础代理

```bash
sudo tee /etc/nginx/sites-available/podifyai.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/podifyai.conf /etc/nginx/sites-enabled/podifyai.conf
sudo nginx -t
sudo systemctl restart nginx
```

### 10.2 HTTP 验证

```bash
curl -I http://127.0.0.1/
curl -I http://your-domain.com/
```

## 11. 域名与 DNS

如果你使用独立域名或二级域名，必须先让域名真实解析到服务器公网 IP。

例如：
- 域名：`podifyai.dpdns.org`
- 服务器公网 IP：`3.129.71.123`

应新增：
- 类型：`A`
- 名称：`@` 或该 DNS 面板要求的根记录形式
- 内容：`3.129.71.123`

注意：
- 如果 DNS 面板当前操作对象已经是 `podifyai.dpdns.org`，就不要再新建一个 `podifyai`
- 否则会错误地变成 `podifyai.podifyai.dpdns.org`

### 11.1 DNS 验证命令

本地验证：

```bash
nslookup your-domain.com
```

服务器验证：

```bash
getent hosts your-domain.com
```

如果结果解析不到 IP：
- 不是应用问题
- 先修 DNS

## 12. 配置 HTTPS

### 12.1 证书申请前检查

先确认：
- 域名已经解析到服务器
- `80` 端口已放行
- Nginx 已能响应域名的 HTTP 请求

### 12.2 用 Certbot 申请证书

```bash
sudo certbot --nginx -d your-domain.com --non-interactive --agree-tos --register-unsafely-without-email --redirect
```

证书申请成功后，Nginx 会自动加上：
- `443 ssl`
- 证书路径
- HTTP 自动跳转 HTTPS

### 12.3 HTTPS 完成后的环境变量调整

把 `.env.local` 中的：

```env
SESSION_COOKIE_SECURE=false
```

改成：

```env
SESSION_COOKIE_SECURE=true
```

然后重启：

```bash
sudo systemctl restart podifyai
```

### 12.4 HTTPS 验证

```bash
curl -I https://your-domain.com/
curl -I http://your-domain.com/
```

预期结果：
- `https://your-domain.com/` 返回 `200`
- `http://your-domain.com/` 返回 `301` 并跳到 `https://...`

## 13. 日常更新流程

### 13.1 推荐更新方式

如果服务器本地就是 Git 仓库：

```bash
cd /opt/podifyai
source .venv/bin/activate
git pull --ff-only origin main
pip install -r requirements-ec2.txt
python -m unittest discover -s tests -v
sudo systemctl restart podifyai
sudo systemctl status podifyai --no-pager
```

### 13.2 使用更新脚本

```bash
cd /opt/podifyai
cp deploy/ec2/update.sh.example deploy/ec2/update.sh
chmod +x deploy/ec2/update.sh
./deploy/ec2/update.sh
```

## 14. 常见问题与解决办法

### 14.1 `podifyai.service` 启动失败，日志里出现 `bash\r`

表现：

```text
/usr/bin/env: 'bash\r': No such file or directory
```

原因：
- shell 脚本是 Windows CRLF 换行
- Linux 把 `bash\r` 当成错误命令

解决：

```bash
sed -i 's/\r$//' deploy/ec2/start.sh deploy/ec2/update.sh.example
chmod +x deploy/ec2/start.sh
sudo systemctl restart podifyai
```

仓库层面已经通过 `.gitattributes` 固定了这些文件应使用 LF。

### 14.2 `init_db.py` 执行时报 `user_id` 为空

表现：
- 初始化管理员账号时报 `NOT NULL constraint failed: user_api_key.user_id`

原因：
- 管理员用户还没拿到 `id` 就创建了关联记录

当前仓库里已经修正。

如果你用的是旧版本：
- 升级代码后再执行
- 或临时改用“先 `db.create_all()`，再 `create_admin_user.py`”

### 14.3 服务器本机 `curl http://127.0.0.1/` 正常，但公网打不开

优先检查：
- AWS Security Group / 云防火墙 是否放行 `80`
- 域名是否解析到了这台机器

判断方法：
- 本机正常 + 外网失败：大概率是网络入口问题，不是应用问题

### 14.4 证书申请成功，但外部 `https://` 仍打不开

优先检查：
- `443` 端口是否已放行

判断方法：
- 服务器本机 `curl -k https://127.0.0.1/ -H 'Host: your-domain.com'` 正常
- 外部 `https://your-domain.com` 不通
- 基本就是云平台没放开 `443`

### 14.5 在 PowerShell 里远程写 Nginx 配置时，`$host` 被吞掉

表现：
- 配置文件里变成空值或奇怪的 PowerShell 变量值
- Nginx 报 `proxy_set_header` 参数数量错误

原因：
- PowerShell 会先解释 `$host`、`$remote_addr` 等字符串

解决：
- 不要在 PowerShell 双引号字符串里直接写 Nginx 配置
- 推荐用服务器本地编辑
- 或用单引号 here-doc
- 或先生成本地文件再 `scp`

### 14.6 API 正常，但浏览器跨域失败

优先检查 `.env.local`：

```env
ALLOWED_ORIGINS=https://your-domain.com
```

如果仍需保留 IP 访问，也可以写成：

```env
ALLOWED_ORIGINS=http://<server-ip>,https://your-domain.com
```

修改后重启：

```bash
sudo systemctl restart podifyai
```

### 14.7 `SESSION_COOKIE_SECURE` 配置不对

现象：
- HTTP 阶段登录异常
- 或 HTTPS 阶段登录态不稳定

建议：
- HTTP 调试阶段：`false`
- 正式 HTTPS：`true`

## 15. 验收清单

上线前至少确认：
- `systemctl status podifyai` 为 `active (running)`
- `systemctl status nginx` 为 `active (running)`
- `curl -I http://127.0.0.1:8000/` 返回 `200`
- `curl -I http://127.0.0.1/` 返回 `200` 或 `301`
- `curl -I https://your-domain.com/` 返回 `200`
- `curl -I http://your-domain.com/` 返回 `301`
- `https://your-domain.com/api/user/status` 返回 `200`
- `.env.local` 权限是 `600`
- API key 没有出现在 Git 仓库里

## 16. 当前这套部署的边界

这套方案适合：
- 单机部署
- 低到中等流量
- 使用 SQLite 和本地文件目录存储

当前仍是单机边界：
- `app.db`
- `history_audio/`
- `voice_previews/`
- `pdf_storage/`

如果后面要扩容到多台服务器，需要进一步拆分：
- 数据库
- 文件存储
- 后台任务
- 负载均衡
