# Extension storage

Use `utils/storage.ts`. Prefer `storage.local`; use `sync` only for small preferences and handle quota failures. Never store secrets as though extension storage were private—it is visible to the user and local tooling.
