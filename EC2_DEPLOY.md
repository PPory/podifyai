# PodifyAI EC2 部署说明

这份说明面向普通 Linux EC2 主机，默认使用 Gunicorn + systemd + Nginx。

## 1. 拉取代码

```bash
git clone <your-github-repo-url> podifyai
cd podifyai
```

## 2. 安装运行环境

```bash
sudo yum update -y || sudo apt update -y
sudo yum install -y python3 python3-pip nginx ffmpeg git || sudo apt install -y python3 python3-pip python3-venv nginx ffmpeg git

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements-ec2.txt
```

## 3. 配置环境变量

在项目根目录准备 `.env.local`，至少填好这些值：

- `SECRET_KEY`
- `OPENAI_API_KEY`
- `OPENAI_API_BASE`
- `SILICONFLOW_API_KEY`
- `SILICONFLOW_API_BASE`
- `ALLOWED_ORIGINS`
- 需要登录、支付、邮件时再补 `SENDGRID_*`、`STRIPE_*`

如果你用域名，`ALLOWED_ORIGINS` 要写成实际访问域名，例如：

```env
ALLOWED_ORIGINS=https://podifyai.example.com
SESSION_COOKIE_SECURE=true
```

## 4. 启动 Gunicorn

先本地试跑一次：

```bash
chmod +x deploy/ec2/start.sh
./deploy/ec2/start.sh
```

默认监听 `127.0.0.1:8000` 的上游入口是 Nginx，Gunicorn 监听地址由 `gunicorn.conf.py` 控制。

## 5. 配置 systemd

```bash
sudo cp deploy/ec2/podifyai.service.example /etc/systemd/system/podifyai.service
sudo systemctl daemon-reload
sudo systemctl enable podifyai
sudo systemctl start podifyai
sudo systemctl status podifyai
```

如果项目目录不是 `/home/ec2-user/podifyai`，先修改 service 文件里的路径。

## 6. 配置 Nginx

```bash
sudo cp deploy/nginx/podifyai.conf.example /etc/nginx/conf.d/podifyai.conf
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

如需 HTTPS，建议再接入 Certbot。

## 7. 更新到 GitHub 后拉新代码

```bash
cd /home/ec2-user/podifyai
git pull origin main
source .venv/bin/activate
pip install -r requirements-ec2.txt
sudo systemctl restart podifyai
```

## 8. 部署前检查

```bash
python -X utf8 -m unittest discover -s tests -v
python -X utf8 -c "import app; print('IMPORT_OK')"
node --check static/api.js
node --check static/synth.js
node --check static/history.js
node --check static/player.js
```
