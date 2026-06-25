---
name: feedback_repo_singleton_vs_class
description: ActiveVehicleAssignmentRepository is a singleton export; VehicleRepository is a class — import and instantiate differently
metadata:
  type: feedback
---

`ActiveVehicleAssignmentRepository` is exported as `export default new ActiveVehicleAssignmentRepository()` — import it and call methods directly, do NOT use `new`.

`VehicleRepository` is exported as a class — instantiate it at module scope with `const vehicleRepo = new VehicleRepository()`.

**Why:** These two repositories follow different export patterns in the same codebase. Mixing them up causes TypeScript errors ("not a constructor" or missing methods).

**How to apply:** Any time you import from `Repositories/ActiveVehicleAssignmentRepository` or `Repositories/VehicleRepository`, check which pattern applies before writing call sites.
