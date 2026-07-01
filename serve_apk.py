import paramiko
import time
import os
from pathlib import Path

# ---------- 凭据加载（从 .env.deploy 或环境变量读取，不硬编码）----------
def load_env(path):
    """简易 .env 解析"""
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
    exit(1)

def run_cmd(ssh, cmd, timeout=30):
    print(f'>>> {cmd}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    stdout.channel.set_combine_stderr(True)
    out = stdout.read().decode('utf-8', errors='replace')
    if out:
        print(out, end='')
    exit_code = stdout.channel.exit_status
    print(f'<<< exit code: {exit_code}')
    return exit_code

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f'连接服务器 {HOST}...')
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    print('SSH连接成功!')

    # 用IP地址和Host头测试
    run_cmd(ssh, f'curl -sI -H "Host: {HOST}" http://localhost:80/app-debug.apk | head -5')
    run_cmd(ssh, f'curl -sI http://{HOST}:80/app-debug.apk | head -5')

    ssh.close()

if __name__ == '__main__':
    main()
