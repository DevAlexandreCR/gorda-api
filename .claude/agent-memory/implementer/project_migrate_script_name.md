---
name: project_migrate_script_name
description: Correct npm script name for running Sequelize dev migrations in the api service
metadata:
  type: project
---

The dev migration npm script in `/Users/alexandrecr/devs/gorda/gorda-driver/api/package.json` is `migrate:sql:development`, NOT `migrate:sql:dev`. Run it via `docker compose exec api sh -lc "npm run migrate:sql:development"` from `/Users/alexandrecr/devs/gorda/gorda-driver/dock`.

**Why:** A task prompt referenced `migrate:sql:dev` (likely shorthand/typo) which fails with "Missing script". Discovered the real name via `npm run` (no args) which lists all available scripts.

**How to apply:** Whenever asked to run dev migrations for the api service, use `migrate:sql:development`. If ever renamed, re-verify with a bare `npm run` inside the api container before assuming the shorthand form works.
