# PodifyAI EC2 快速部署清单

这份文档只保留最短上线路径。

如果你要看完整流程、排障经验和常见问题，主文档请看：
- [vps-runbook.md](vps-runbook.md)

适用场景：
- 单台 AWS EC2
- Ubuntu 22.04 / 24.04
- Flask + Gunicorn + Nginx
- SQLite 本地存储

## 1. 部署前准备

确认这几件事已经完成：
- 已有服务器公网 IP
- 已放行 `22` / `80` / `443`
- 如果使用域名，DNS 已解析到服务器公网 IP
- 已准备好 `.env.local`

## 2. 安装系统依赖

```bash
sudo apt update
sudo apt install -y git nginx ffmpeg python3 python3-venv python3-pip certbot python3-certbot-nginx
```

## 3. 放置代码

推荐方式：本地打包后上传。

服务器上准备目录：

```bash
sudo mkdir -p /opt/podifyai
sudo chown $USER:$USER /opt/podifyai
cd /opt/podifyai
```

如果直接从 GitHub 拉代码：

```bash
git clone <your-github-repo-url> .
```

## 4. 配置环境变量

```bash
cp .env.example .env.local
chmod 600 .env.local
```

至少填写：
- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `OPENAI_API_KEY`
- `OPENAI_API_BASE`
- `SILICONFLOW_API_KEY`
- `SILICONFLOW_API_BASE`

如果还没配 HTTPS，可先这样：

```env
ALLOWED_ORIGINS=http://<server-ip>,http://your-domain.com
SESSION_COOKIE_SECURE=false
```

## 5. 安装 Python 依赖

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements/ec2.txt
```

## 6. 初始化数据库

先建表：

```bash
python - <<'PY'
from app import app, db
with app.app_context():
    db.create_all()
    print('DB_READY')
PY
```

如需管理员账号：

```bash
python tools/create_admin_user.py
```

## 7. 自检

```bash
python -m py_compile app.py wsgi.py deploy/gunicorn.conf.py tools/init_db.py tools/create_admin_user.py
python -m py_compile podifyai/*.py
python -X utf8 -m unittest discover -s tests -v
python -X utf8 -c "import app; print('IMPORT_OK')"
```

## 8. 先本地试跑 Gunicorn

```bash
chmod +x deploy/ec2/start.sh
./deploy/ec2/start.sh
```

另开一个终端验证：

```bash
curl -I http://127.0.0.1:8000/
```

## 9. 配置 systemd

```bash
sudo cp deploy/ec2/podifyai.service.example /etc/systemd/system/podifyai.service
sudo nano /etc/systemd/system/podifyai.service
sudo systemctl daemon-reload
sudo systemctl enable podifyai
sudo systemctl start podifyai
sudo systemctl status podifyai --no-pager
```

## 10. 配置 Nginx

```bash
sudo cp deploy/nginx/podifyai.conf.example /etc/nginx/sites-available/podifyai
sudo ln -sf /etc/nginx/sites-available/podifyai /etc/nginx/sites-enabled/podifyai
sudo nginx -t
sudo systemctl restart nginx
```

验证：

```bash
curl -I http://127.0.0.1/
curl -I http://your-domain.com/
```

## 11. 配置 HTTPS

```bash
sudo certbot --nginx -d your-domain.com --non-interactive --agree-tos --register-unsafely-without-email --redirect
```

然后把 `.env.local` 中的：

```env
SESSION_COOKIE_SECURE=false
```

改成：

```env
SESSION_COOKIE_SECURE=true
```

重启：

```bash
sudo systemctl restart podifyai
```

验证：

```bash
curl -I https://your-domain.com/
curl -I http://your-domain.com/
```

预期结果：
- HTTPS 返回 `200`
- HTTP 跳转到 HTTPS

## 12. 后续更新

```bash
cd /opt/podifyai
source .venv/bin/activate
git pull --ff-only origin main
pip install -r requirements/ec2.txt
python -m unittest discover -s tests -v
sudo systemctl restart podifyai
```

或者：

```bash
cp deploy/ec2/update.sh.example deploy/ec2/update.sh
chmod +x deploy/ec2/update.sh
./deploy/ec2/update.sh
```

## 13. 如果出问题优先看哪里

按顺序检查：
- `systemctl status podifyai --no-pager`
- `systemctl status nginx --no-pager`
- `sudo journalctl -u podifyai -n 50 --no-pager`
- `curl -I http://127.0.0.1:8000/`
- `curl -I http://127.0.0.1/`
- `nslookup your-domain.com`

如果要看完整排障说明，直接回到：
- [vps-runbook.md](vps-runbook.md)
