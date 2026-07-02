---
name: project_service_repository_circular_import
description: api/src/Models/Service.ts and api/src/Repositories/ServiceRepository.ts have a circular import — Service.ts imports ServiceRepository (for cancel()). ServiceRepository.ts only imports ServiceInterface, not the Service class.
metadata:
  type: project
---

`api/src/Models/Service.ts` imports `ServiceRepository` (used in `cancel()`). `api/src/Repositories/ServiceRepository.ts` only imports `ServiceInterface`, never the `Service` class itself — importing `Service` there would create a circular import.

**Why:** Discovered while adding an `origin` field defaulted at the RTDB write chokepoint in `ServiceRepository.create()`. The task asked to prefer `Service.ORIGIN_BOT` constant but fall back to the string literal `'bot'` if importing `Service` into `ServiceRepository` would cycle. It does cycle, so the literal `'bot'` was used with an inline comment explaining why (not `Service.ORIGIN_BOT`).

**How to apply:** When adding logic to `ServiceRepository.ts` that would otherwise reference `Service` static constants/methods, use the string/primitive literal instead of importing the `Service` model, and leave a short comment noting the circular-import reason. If this constraint changes (e.g., `Service.ts` stops importing `ServiceRepository`), re-verify before assuming the cycle still exists.
