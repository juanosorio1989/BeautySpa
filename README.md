# BeautySpa

Salon booking SaaS. Turborepo + pnpm monorepo (`apps/*`, `packages/*`).

## Quick start

```bash
nvm use            # Node 22
pnpm install
cp .env.example .env
docker compose up -d   # postgres, redis, mailpit
pnpm lint && pnpm typecheck && pnpm test
```

Full setup docs arrive with the later foundation tasks.
