# United in Joy Christmas 2026

Standalone Next.js app for attendee registration, QR tickets, competition entry, staff check-in, and King/Queen voting — backed by shared Postgres. CCF Thailand branding (red / forest green / gold / cream ticket aesthetic).

## Quick start

```bash
# 1) Start Postgres (Docker Compose) OR use a hosted DATABASE_URL
# Set POSTGRES_PASSWORD in the environment (compose default is CHANGE_ME placeholder only)
export POSTGRES_PASSWORD='your-local-db-password'
docker compose up -d

# 2) Configure env
cp .env.example .env
# Replace every CHANGE_ME: SESSION_SECRET, ORGANIZER_*, STAFF_*, DATABASE_URL password

# 3) Install, migrate, seed
npm install
npx prisma migrate deploy
npm run db:seed

# 4) Run
npm run dev
```

Open http://localhost:3000

Seed credentials come from env (`ORGANIZER_USERNAME` / `ORGANIZER_PASSWORD`, `STAFF_USERNAME` / `STAFF_PASSWORD`).

See project docs for deployment, organizer guide, testing, and limitations.
