# Security Configuration

## Required Environment Variables

### Server (`server/.env`)

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes (production) | JWT signing key. Generate with `openssl rand -hex 32` |
| `SETTINGS_ENCRYPTION_KEY` | Yes (production) | Encryption key for stored API keys. Generate with `openssl rand -hex 32` |
| `DEEPSEEK_API_KEY` | For AI features | DeepSeek API key from https://platform.deepseek.com |
| `SILICONFLOW_API_KEY` | For embedding | SiliconFlow API key from https://api.siliconflow.cn |
| `DEVICE_PAIRING_CODE` | Yes (production) | Device pairing code for first-time setup |
| `OWNER_TIMEZONE` | No | Owner calendar timezone; defaults to `Asia/Shanghai` |
| `CORS_ORIGINS` | Yes (production) | Comma-separated trusted web/Capacitor origins |

### Deployment (`.env.deploy`)

| Variable | Required | Description |
|---|---|---|
| `SSH_HOST` | Yes | Server IP or hostname |
| `SSH_USER` | Yes | Restricted deployment user |
| `SSH_KEY_PATH` | Yes | Local private key path |
| `SSH_KNOWN_HOSTS` | Yes | Local known_hosts file used for strict host verification |

### Client (`client/.env.production`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | Backend API URL (e.g. `https://your-domain.com/api`) |

## Setup Instructions

1. Copy example files and fill in real values:
   ```bash
   cp .env.example .env           # server config
   cp .env.deploy.example .env.deploy  # deployment credentials
   cp server/.env.example server/.env  # server env for docker
   ```

2. Generate secure random keys:
   ```bash
   openssl rand -hex 32   # for JWT_SECRET
   openssl rand -hex 32   # for SETTINGS_ENCRYPTION_KEY
   ```

3. All `.env` files are in `.gitignore` and will NOT be committed.

## Files Protected by .gitignore

- `.env`, `.env.local`, `.env.*.local`
- `server/.env`
- `.env.deploy`
- `.workbuddy/`

## Key Rotation Notice

The following secrets were previously committed to version control in plaintext.
**They MUST be rotated immediately:**

1. **SSH server password** -- was hardcoded in `serve_apk.py`, `.workbuddy/check_status.py`, `.workbuddy/rebuild.py`, and `.env.deploy`
2. **Server IP address** -- was exposed in multiple files. While not a secret per se, it reduces attack surface to keep it out of public repos.

### Rotation Steps

1. Change the server SSH password on the cloud console
2. Install a deployment public key for a restricted server user
3. Update `.env.deploy` with the key and known_hosts paths
4. If the git repo was ever public, assume all previously committed secrets are compromised

## Best Practices

- Never commit `.env` files with real values
- Use `openssl rand -hex 32` to generate secrets
- Rotate API keys periodically
- Use SSH key authentication and strict host verification
- In production, the server refuses to start without `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, and `DEVICE_PAIRING_CODE`
