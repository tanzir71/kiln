# Extension page overlays

Use a WXT content script and `createShadowRootUi` so extension styles cannot collide with the host page. Scope matches narrowly in entrypoint metadata and clean up observers/UI on unload.
