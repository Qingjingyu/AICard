# AI Card Public Deployment

This package serves the independent identity authority at `id.yoyooai.com`.
It uses a dedicated PostgreSQL database and binds the application only to
`127.0.0.1:4174`; it does not reuse Yoyoo storage or expose PostgreSQL publicly.

## Release boundary

- `yoyoo_prod` is the production client. `yoyoo_dev` remains localhost-only.
- The exact Yoyoo callback is
  `https://app.yoyooai.com/auth/aicard/callback`.
- Migrations are checksum tracked and forward-only.
- The tracked client document contains no secret. Database passwords remain in
  the untracked production `.env` only.

## Preflight and backup

Before any production write:

1. Verify `id.yoyooai.com` resolves only to the intended host and has no stale
   AAAA record.
2. Record the current Yoyoo image, container health, Nginx configuration, and
   all existing virtual hosts.
3. Create a fresh Yoyoo PostgreSQL dump and BlobStore archive, verify both can
   be read, then back up `/etc/nginx`.
4. If AI Card already exists, also dump its database and record its image.
5. Generate `POSTGRES_PASSWORD` on the host. Never paste it into Git, chat, a
   process argument, or deployment output.

## Build and start

Copy `.env.example` to the untracked `.env`, replace placeholders, then run from
this directory:

```bash
docker build --tag "aicard:<commit>" ../..
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml up -d postgres
docker compose --env-file .env -f compose.yml run --rm migrate
docker compose --env-file .env -f compose.yml run --rm register-yoyoo
docker compose --env-file .env -f compose.yml up -d app
docker compose --env-file .env -f compose.yml run --rm app npm run production:doctor
```

Install `nginx.id.http.conf` only after `127.0.0.1:4174/api/health` returns
`200`. Validate Nginx, obtain the `id.yoyooai.com` certificate with the host's
existing Certbot workflow, then replace the bootstrap file with
`nginx.id.https.conf` and validate Nginx again.

## Cut Yoyoo over

After public AI Card health and the production doctor pass, configure Yoyoo:

```dotenv
YOYOO_AICARD_ISSUER=https://id.yoyooai.com
YOYOO_AICARD_CLIENT_ID=yoyoo_prod
YOYOO_AICARD_AUDIENCE=yoyoo
YOYOO_AICARD_REDIRECT_URI=https://app.yoyooai.com/auth/aicard/callback
YOYOO_AICARD_SESSION_SECRET=<host-generated-32-byte-base64url-value>
```

Restart only the Yoyoo app container. Keep password mode during the first
release so the existing owner can recover if the identity provider is
unavailable; the UI still makes AI Card the primary path.

## Acceptance

- `https://id.yoyooai.com/api/health` and
  `https://app.yoyooai.com/api/health` return `200`.
- A new browser registers once, receives `AI_100001`, authorizes Yoyoo, and
  reaches the existing workspace.
- A second clean browser reuses the same AI Card rather than allocating another.
- Logout clears the Yoyoo session; revoked authorization is rejected.
- Existing Yoyoo password login still works as rollback access.
- Desktop and `390x844` mobile views have no blocking console or overflow error.

## Rollback

The reversible application rollback is:

1. Restore the backed-up Yoyoo `.env` without the five AI Card variables.
2. Restart only the previous Yoyoo app image and verify password login.
3. Disable the new `id.yoyooai.com` Nginx virtual host.
4. Stop AI Card app services but retain its PostgreSQL volume and image.

Do not delete volumes or restore either database automatically. Data restore is
destructive and requires a new backup, an exact restore point, and separate
approval. Applied migrations are never edited or rolled back in place.
