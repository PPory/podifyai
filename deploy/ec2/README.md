# EC2 部署说明

适用场景：单台 AWS EC2，Flask + Gunicorn + Nginx，数据保存在当前机器本地。

## 1. 准备机器

推荐 Ubuntu 22.04 或 24.04。

```bash
sudo apt update
sudo apt install -y git nginx ffmpeg python3 python3-venv python3-pip
```

## 2. 拉代码并创建环境

```bash
sudo mkdir -p /opt/podifyai
sudo chown $USER:$USER /opt/podifyai
cd /opt/podifyai

git clone <你的 GitHub 仓库地址> .
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements-ec2.txt
```

## 3. 配置环境变量

```bash
cp .env.local.example .env.local
```

至少确认这些值已经填好：
- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `OPENAI_API_KEY`
- `SILICONFLOW_API_KEY`
- `SENDGRID_*` 或 SMTP 配置
- `STRIPE_*`

如果当前域名还没接好，先把 `SESSION_COOKIE_SECURE=false` 留着；正式切 HTTPS 后删除这一行。

## 4. 先跑自检

```bash
source .venv/bin/activate
python -m py_compile app.py auth.py billing.py content.py decorators.py extensions.py history.py models.py services.py static_routes.py tts.py voices.py wsgi.py gunicorn.conf.py
python -m unittest discover -s tests -v
```

## 5. 先本地试跑 Gunicorn

```bash
chmod +x deploy/ec2/start.sh
./deploy/ec2/start.sh
```

Gunicorn 监听地址由 `gunicorn.conf.py` 控制，默认是 `127.0.0.1:8000`。

## 6. 配置 systemd

把示例文件复制到系统目录后，按你的实际路径修改：

```bash
sudo cp deploy/ec2/podifyai.service.example /etc/systemd/system/podifyai.service
sudo nano /etc/systemd/system/podifyai.service
```

需要改的通常只有：
- `User`
- `Group`
- `WorkingDirectory`
- `EnvironmentFile`
- `ExecStart`

然后启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable podifyai
sudo systemctl start podifyai
sudo systemctl status podifyai --no-pager
```

## 7. 配置 Nginx

```bash
sudo cp deploy/nginx/podifyai.conf.example /etc/nginx/sites-available/podifyai
sudo nano /etc/nginx/sites-available/podifyai
sudo ln -s /etc/nginx/sites-available/podifyai /etc/nginx/sites-enabled/podifyai
sudo nginx -t
sudo systemctl restart nginx
```

如果你已经有域名，再接上 HTTPS 证书。

## 8. 后续从 GitHub 更新

```bash
cd /opt/podifyai
source .venv/bin/activate
git pull --ff-only origin main
pip install -r requirements-ec2.txt
python -m unittest discover -s tests -v
sudo systemctl restart podifyai
```

如果想要一条命令更新，可以复制：

```bash
cp deploy/ec2/update.sh.example deploy/ec2/update.sh
chmod +x deploy/ec2/update.sh
```

## 9. 现在这套部署的边界

- 这是单机部署，`app.db`、`history_audio/`、`voice_previews/`、`pdf_storage/` 都在当前机器上。
- 如果你后面要扩容到多台机器，数据库和文件存储需要拆出去。
- 现在最适合的用法是：单台 EC2 + GitHub 拉代码更新。
