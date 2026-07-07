"""
论文阅读器 — 安全部署脚本

用法：
  1. 复制 .env.deploy.example 为 .env.deploy，配置 SSH Key 与 known_hosts
  2. python deploy_final.py

.env.deploy 格式：
  SSH_HOST=你的服务器IP
  SSH_USER=deploy
  SSH_KEY_PATH=你的私钥路径
  SSH_KNOWN_HOSTS=known_hosts 路径
"""

import paramiko
import os
import sys
import time
import shlex
from datetime import datetime, timezone
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
KEY_PATH = os.environ.get('SSH_KEY_PATH') or _env.get('SSH_KEY_PATH', '')
KNOWN_HOSTS = os.environ.get('SSH_KNOWN_HOSTS') or _env.get('SSH_KNOWN_HOSTS', '')

if not HOST or not KEY_PATH or not KNOWN_HOSTS:
    print('错误: 缺少 SSH_HOST / SSH_KEY_PATH / SSH_KNOWN_HOSTS')
    sys.exit(1)

LOCAL_TAR = os.environ.get('DEPLOY_ARCHIVE') or _env.get('DEPLOY_ARCHIVE', str(Path(__file__).with_name('paper-reader-final-deploy.tar.gz')))
RELEASE_ROOT = '/opt/paper-reader/releases'
CURRENT_LINK = '/opt/paper-reader/current'
REMOTE_TAR = '/tmp/paper-reader-final-deploy.tar.gz'


def get_ssh():
    ssh = paramiko.SSHClient()
    ssh.load_host_keys(str(Path(KNOWN_HOSTS).expanduser()))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect(HOST, username=USER, key_filename=str(Path(KEY_PATH).expanduser()), timeout=30,
                allow_agent=True, look_for_keys=True)
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


def upload_archive(ssh, local, remote):
    with ssh.open_sftp() as sftp:
        sftp.put(local, remote)
        if sftp.stat(remote).st_size != os.path.getsize(local):
            raise RuntimeError('部署包上传后大小不一致')


def main():
    if not os.path.exists(LOCAL_TAR):
        print(f'错误: 部署包不存在 {LOCAL_TAR}')
        sys.exit(1)

    ssh = get_ssh()
    ssh.get_transport().set_keepalive(20)
    upload_archive(ssh, LOCAL_TAR, REMOTE_TAR)
    release = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    release_dir = f'{RELEASE_ROOT}/{release}'
    quoted_release = shlex.quote(release_dir)

    print('\n=== 创建版本化 release ===')
    if run_cmd(ssh, f'mkdir -p {quoted_release} && tar xzf {REMOTE_TAR} -C {quoted_release}') != 0:
        raise RuntimeError('解压 release 失败')

    previous = run_cmd_capture(ssh, f'readlink -f {CURRENT_LINK} || true')

    print('\n=== 备份数据库 ===')
    if previous and run_cmd(ssh, "docker exec paper-reader node dist/scripts/backupDb.js") != 0:
        raise RuntimeError('部署前数据库备份失败')

    print('\n=== 构建并启动 ===')
    if run_cmd(ssh, f'cd {quoted_release} && docker compose -p paper-reader -f docker-compose.server.yml up -d --build', timeout=1200) != 0:
        raise RuntimeError('容器构建或启动失败')

    print('\n=== 健康检查 ===')
    healthy = run_cmd(ssh, "for i in $(seq 1 30); do curl -fsS http://localhost:3001/api/ready && exit 0; sleep 2; done; exit 1") == 0
    if not healthy:
        if previous:
            run_cmd(ssh, f'cd {shlex.quote(previous)} && docker compose -p paper-reader -f docker-compose.server.yml up -d --build', timeout=1200)
        raise RuntimeError('新版本 readiness 失败，已尝试回滚')
    run_cmd(ssh, f'ln -sfn {quoted_release} {CURRENT_LINK} && ls -1dt {RELEASE_ROOT}/* | tail -n +4 | xargs -r rm -rf')

    ssh.close()
    print('\n✅ 部署完成!')


def run_cmd_capture(ssh, cmd):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    value = stdout.read().decode('utf-8', errors='replace').strip()
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError(stderr.read().decode('utf-8', errors='replace'))
    return value


if __name__ == '__main__':
    main()
