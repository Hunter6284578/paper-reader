"""
论文阅读器 — 部署脚本 v5
凭据从本地 .env.deploy 读取，不再硬编码

用法：
  1. 复制 .env.deploy.example 为 .env.deploy，填入服务器密码
  2. python deploy_final.py

.env.deploy 格式：
  SSH_HOST=你的服务器IP
  SSH_USER=root
  SSH_PASSWORD=你的密码
"""

import paramiko
import os
import sys
import time
import base64
from pathlib import Path

# ---------- 凭据加载 ----------
def load_env(path):
    """简易 .env 解析，不依赖 python-dotenv"""
    env = {}
    p = Path(path)
    if not p.exists():
        return env
    for line in p.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            continue
        k, _, v = line.partition('=')
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV_FILE = Path(__file__).parent / '.env.deploy'
_env = load_env(ENV_FILE)

HOST = os.environ.get('SSH_HOST') or _env.get('SSH_HOST', '')
USER = os.environ.get('SSH_USER') or _env.get('SSH_USER', 'root')
PASSWORD = os.environ.get('SSH_PASSWORD') or _env.get('SSH_PASSWORD', '')

if not HOST or not PASSWORD:
    print('错误: 缺少服务器凭据。请创建 .env.deploy 文件（参考 .env.deploy.example）')
    print('  或设置环境变量 SSH_HOST / SSH_PASSWORD')
    sys.exit(1)

LOCAL_TAR = r'D:\论文阅读器\paper-reader-final-deploy.tar.gz'
REMOTE_DIR = '/opt/paper-reader'
REMOTE_TAR = '/tmp/paper-reader-final-deploy.tar.gz'
CHUNK_SIZE = 48 * 1024
SLEEP_BETWEEN = 3.0


def get_ssh():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30,
                allow_agent=False, look_for_keys=False)
    return ssh


def run_cmd(ssh, cmd, timeout=900):
    print(f'\n>>> {cmd[:150]}{"..." if len(cmd) > 150 else ""}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            chunk = stdout.channel.recv(4096).decode('utf-8', errors='replace')
            if chunk:
                print(chunk, end='')
        if stdout.channel.recv_stderr_ready():
            chunk = stdout.channel.recv_stderr(4096).decode('utf-8', errors='replace')
            if chunk:
                print(chunk, end='')
        time.sleep(0.1)
    remaining = stdout.read().decode('utf-8', errors='replace')
    if remaining:
        print(remaining, end='')
    err = stderr.read().decode('utf-8', errors='replace')
    if err:
        print(err, end='')
    exit_code = stdout.channel.exit_status
    print(f'<<< exit code: {exit_code}')
    return exit_code


def upload_small_chunks(local, remote):
    file_size = os.path.getsize(local)
    total_chunks = (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    print(f'\n=== 小块上传 {file_size/1024/1024:.2f}MB 分 {total_chunks} 块 ===')

    ssh = get_ssh()
    run_cmd(ssh, f'rm -f {remote} && touch {remote}')
    ssh.close()
    time.sleep(SLEEP_BETWEEN)

    sent = 0
    with open(local, 'rb') as f:
        for i in range(total_chunks):
            raw = f.read(CHUNK_SIZE)
            if not raw:
                break
            b64 = base64.b64encode(raw)

            for attempt in range(3):
                try:
                    ssh = get_ssh()
                    stdin, stdout, stderr = ssh.exec_command(f'base64 -d >> {remote}', timeout=30)
                    stdin.write(b64)
                    stdin.flush()
                    stdin.channel.shutdown_write()
                    exit_code = stdout.channel.recv_exit_status()
                    ssh.close()
                    if exit_code == 0:
                        break
                    else:
                        print(f'  块 {i+1} 失败, 重试 {attempt+1}/3')
                        time.sleep(SLEEP_BETWEEN * 2)
                except Exception:
                    try:
                        ssh.close()
                    except:
                        pass
                    time.sleep(SLEEP_BETWEEN * 2)
            else:
                raise RuntimeError(f'块 {i+1}/{total_chunks} 3次重试均失败')

            sent += len(raw)
            pct = sent / file_size * 100
            print(f'  [{i+1}/{total_chunks}] {pct:.0f}%')
            time.sleep(SLEEP_BETWEEN)

    ssh = get_ssh()
    stdin, stdout, stderr = ssh.exec_command(f'stat -c %s {remote}')
    remote_size = int(stdout.read().decode().strip())
    ssh.close()
    if remote_size != file_size:
        raise RuntimeError(f'大小不匹配: {file_size} vs {remote_size}')
    print(f'  ✅ 上传完成 ({remote_size} bytes)')


def main():
    if not os.path.exists(LOCAL_TAR):
        print(f'错误: 部署包不存在 {LOCAL_TAR}')
        sys.exit(1)

    upload_small_chunks(LOCAL_TAR, REMOTE_TAR)

    ssh = get_ssh()
    ssh.get_transport().set_keepalive(20)

    print('\n=== 解压 ===')
    run_cmd(ssh, f'mkdir -p {REMOTE_DIR} && cd {REMOTE_DIR} && tar xzf {REMOTE_TAR} && echo OK')

    print('\n=== 停止旧容器 ===')
    run_cmd(ssh, f'cd {REMOTE_DIR} && docker compose -f docker-compose.server.yml down 2>&1 || true')

    print('\n=== 构建并启动 ===')
    run_cmd(ssh, f'cd {REMOTE_DIR} && docker compose -f docker-compose.server.yml up -d --build 2>&1', timeout=900)

    print('\n=== 容器状态 ===')
    run_cmd(ssh, 'docker ps | grep paper-reader')

    print('\n=== 健康检查 ===')
    run_cmd(ssh, 'sleep 8 && curl -s http://localhost:3001/api/health')

    ssh.close()
    print('\n✅ 部署完成!')


if __name__ == '__main__':
    main()
