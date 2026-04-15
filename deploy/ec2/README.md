# deploy/ec2 目录说明

这份文档只解释 `deploy/ec2/` 目录里的文件用途。

如果你要看完整部署流程、域名、HTTPS、排障和日常更新，请直接看：
- `VPS_DEPLOY_RUNBOOK.md`

如果你只想快速照着命令部署，请看：
- `EC2_DEPLOY.md`

## 目录内文件分工

### `start.sh`

用途：
- 启动 Gunicorn
- 作为 systemd 的 `ExecStart`

默认行为：
- 自动定位项目根目录
- 使用 `/opt/podifyai/.venv/bin/gunicorn`
- 读取 `gunicorn.conf.py`
- 启动 `wsgi:app`

典型用法：

```bash
chmod +x deploy/ec2/start.sh
./deploy/ec2/start.sh
```

### `update.sh.example`

用途：
- 作为更新脚本模板
- 适合服务器本地已经是 Git 仓库的情况

默认做的事：
- 拉取最新代码
- 安装 `requirements-ec2.txt`
- 跑测试
- 重启 `podifyai` 服务

典型用法：

```bash
cp deploy/ec2/update.sh.example deploy/ec2/update.sh
chmod +x deploy/ec2/update.sh
./deploy/ec2/update.sh
```

### `podifyai.service.example`

用途：
- systemd 服务模板
- 让 PodifyAI 支持后台运行和开机自启

你通常只需要核对：
- `User`
- `Group`
- `WorkingDirectory`
- `EnvironmentFile`
- `ExecStart`

典型用法：

```bash
sudo cp deploy/ec2/podifyai.service.example /etc/systemd/system/podifyai.service
sudo nano /etc/systemd/system/podifyai.service
sudo systemctl daemon-reload
sudo systemctl enable podifyai
sudo systemctl start podifyai
```

## 推荐搭配方式

完整部署时，建议按这个关系理解：
- `VPS_DEPLOY_RUNBOOK.md`：主手册
- `EC2_DEPLOY.md`：最短路径清单
- `deploy/ec2/start.sh`：启动脚本
- `deploy/ec2/update.sh.example`：更新脚本模板
- `deploy/ec2/podifyai.service.example`：systemd 模板
- `deploy/nginx/podifyai.conf.example`：Nginx 模板

## 使用提醒

### 1. shell 脚本必须用 LF 换行

如果日志里出现：

```text
/usr/bin/env: 'bash\r': No such file or directory
```

说明脚本是 Windows 换行。

可临时修复：

```bash
sed -i 's/\r$//' deploy/ec2/start.sh deploy/ec2/update.sh.example
```

仓库里已经通过 `.gitattributes` 约束这些文件使用 LF。

### 2. 不要把 API key 写进脚本里

正确做法：
- API key 只放 `.env.local`
- `.env.local` 权限设为 `600`
- systemd 通过 `EnvironmentFile=/opt/podifyai/.env.local` 读取

### 3. 首次部署建议先手动跑一次 `start.sh`

这样更容易分辨问题是在：
- 应用本身
- Gunicorn
- systemd
- Nginx

## 推荐检查命令

```bash
systemctl status podifyai --no-pager
journalctl -u podifyai -n 50 --no-pager
curl -I http://127.0.0.1:8000/
curl -I http://127.0.0.1/
```

## 什么时候看哪份文档

- 想从零部署一台新服务器：看 `VPS_DEPLOY_RUNBOOK.md`
- 想快速照清单操作：看 `EC2_DEPLOY.md`
- 想知道 `deploy/ec2/` 里的每个文件是干什么的：看本文件
