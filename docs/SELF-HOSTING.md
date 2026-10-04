# Self-hosting Troupe

Troupe runs as one container next to PostgreSQL. On start it applies database
migrations and, in the Docker image, checks running renders every 30 seconds
(including while no browser is open).

## Install

```bash
git clone https://github.com/maxgfr/troupe.git && cd troupe
cp .env.example .env        # set POSTGRES_PASSWORD (openssl rand -hex 24)
docker compose up -d
docker compose logs app     # the access code is printed on first start
```

Open <http://localhost:3100> and enter the code.

## Configuration

Everything goes in `.env` next to `docker-compose.yml`.

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_PASSWORD` | — (required) | Database password. Use hex characters so it fits in a URL. |
| `TROUPE_BIND` | `127.0.0.1` | Address the studio listens on. Keep `127.0.0.1` behind a reverse proxy; `0.0.0.0` exposes it to your network. |
| `TROUPE_PORT` | `3100` | Port on the host. |
| `TROUPE_ACCESS_CODE` | generated | The code that opens the studio, at least 12 characters. If empty, one is generated, printed in the logs and saved as `access-code` in the data volume. Changing it signs every browser out. After five wrong codes an address waits 15 minutes. |
| `TROUPE_SECRET` | generated | Encrypts saved API keys and local model tokens (AES-256-GCM). If empty, a random key is saved as `secret.key` in the data volume. **Back it up**: without it saved keys cannot be read and must be entered again. |
| `GOOGLE_GENAI_API_KEY`, `FAL_KEY` | — | Optional provider keys. Keys saved in Settings take precedence. |
| `TROUPE_VERSION` | `latest` | Image tag to run, e.g. `0.1.0`. |

Inside the container: `TROUPE_DATA_DIR=/app/data` (videos, `access-code`,
`secret.key`), `TROUPE_INPROCESS_WORKER=1` (background job checks) and
`TROUPE_AUTO_MIGRATE` (set it to `0` to apply migrations yourself; never on Vercel).

The app always requires the access code in production. Requests are refused
whatever their `Host` header says.

## HTTPS with a reverse proxy

Keep `TROUPE_BIND=127.0.0.1` and put a proxy in front. With
[Caddy](https://caddyserver.com), which obtains certificates by itself:

```caddyfile
studio.example.com {
    reverse_proxy 127.0.0.1:3100
}
```

Caddy sends `X-Forwarded-Host` and `X-Forwarded-Proto`; Troupe uses them to
check request origins and to mark its session cookie `Secure`. Other proxies
(nginx, Traefik) work the same if they forward those two headers.

## Backups

Back up three things together:

1. **The database**:

   ```bash
   docker compose exec -T db pg_dump -U postgres troupe | gzip > troupe-$(date +%F).sql.gz
   ```

2. **The data volume** (videos, `access-code`, `secret.key`):

   ```bash
   docker run --rm -v troupe_troupe-media:/data -v "$PWD":/backup alpine tar czf /backup/troupe-data-$(date +%F).tgz -C /data .
   ```

3. **`.env`**, especially `TROUPE_SECRET` if you set one.

To restore, recreate the volumes, unpack the archive into `troupe_troupe-media`,
start only `db`, pipe the dump into `psql -U postgres troupe`, then start `app`.

## Upgrade

```bash
docker compose pull
docker compose up -d
```

Migrations run on start; several app containers starting at once wait for one
another. To pin a version, set `TROUPE_VERSION=0.1.0` in `.env`.

### From a version before 0.1.0

Earlier versions ran migrations and the job worker as separate services, used
a fixed database password and ran the container as root.

- Set `POSTGRES_PASSWORD=password` in `.env` to keep the existing database (then
  change it with `ALTER USER postgres PASSWORD '…'` and update `.env`).
- The app now runs as the `node` user. If the old data volume belongs to root:

  ```bash
  docker compose run --rm --user root app chown -R node:node /app/data
  ```

- `docker compose up -d --remove-orphans` removes the old `migrate` and `worker`
  containers.

## Local models

Add ComfyUI or your own model server in **Settings → Local models**. From the
container, a ComfyUI running on the same computer is at
`http://host.docker.internal:8188`. With an NVIDIA GPU you can run ComfyUI in
the same stack:

```bash
docker compose --profile comfyui up -d
```

and use `http://comfyui:8188`. Details in [LOCAL-MODELS.md](LOCAL-MODELS.md).

## Troubleshooting

- `docker compose ps` shows the app as unhealthy: `docker compose logs app`.
  The health check (`/api/health`) fails while the database is unreachable.
- Settings → Background checks shows when job checks last ran. Older than five
  minutes means the app process is not running.
- A render marked "did not finish before its time limit" may still be running
  at the provider. Check its dashboard before relaunching.
