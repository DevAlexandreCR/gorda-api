---
name: project_driver_vehicle_resolver
description: DriverVehicleResolver replaces stale store.findDriverById().vehicle lookups; color must pass through as null, never defaulted to empty object
metadata:
  type: project
---

`Services/drivers/DriverVehicleResolver.ts` exports `resolveDriverCurrentVehicle(driverId)`.
It reads fresh from Postgres: active_vehicle_assignments first, then drivers.selected_vehicle_id fallback.
Returns `VehicleRecordInterface | null` — `color` is `{ name, hex? } | null`, matching `VehicleSnapshot.color`.

**Why:** The `store.findDriverById().vehicle` path read from a stale in-memory cache populated at startup; new vehicle assignments after server start were invisible to it.

**How to apply:** Any new code that needs a driver's current vehicle should call `resolveDriverCurrentVehicle`, not `store.findDriverById().vehicle`. Never default `null` color to an empty object — pass `null` through to callers.

Related: [[feedback_repo_singleton_vs_class]]
