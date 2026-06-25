---
name: jest-cli-flag-testPathPatterns
description: Use --testPathPatterns (not --testPathPattern) with Jest 30 in this project
metadata:
  type: feedback
---

Jest 30 replaced `--testPathPattern` with `--testPathPatterns`. Using the old flag emits an error and exits immediately.

**Why:** The api service is on jest@^30.x; the flag was renamed as a breaking change.

**How to apply:** Always use `npx jest --no-coverage --testPathPatterns='<pattern>'` when running targeted tests inside the Docker container.
