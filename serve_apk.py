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
KEY_PATH = os.environ.get('SSH_KEY_PATH') or _env.get('SSH_KEY_PATH', '')
KNOWN_HOSTS = os.environ.get('SSH_KNOWN_HOSTS') or _env.get('SSH_KNOWN_HOSTS', '')

if not HOST or not KEY_PATH or not KNOWN_HOSTS:
    print('错误: 缺少 SSH_HOST / SSH_KEY_PATH / SSH_KNOWN_HOSTS')
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
    ssh.load_host_keys(str(Path(KNOWN_HOSTS).expanduser()))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    print(f'连接服务器 {HOST}...')
    ssh.connect(HOST, username=USER, key_filename=str(Path(KEY_PATH).expanduser()), timeout=30,
                allow_agent=True, look_for_keys=True)
    print('SSH连接成功!')

    # 用IP地址和Host头测试
    run_cmd(ssh, f'curl -sI -H "Host: {HOST}" http://localhost:80/app-debug.apk | head -5')
    run_cmd(ssh, f'curl -sI http://{HOST}:80/app-debug.apk | head -5')

    ssh.close()

if __name__ == '__main__':
    main()
