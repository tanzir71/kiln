# Local data

Use the preinstalled `electron-store` for settings and small JSON-shaped data. Allowed package `better-sqlite3` is for larger relational datasets; open the database in the main process and expose narrow methods, not raw SQL, to the renderer.
