// LOCKED BY KILN except for the marked manifest permission block.
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '__APP_NAME__',
    description: '__APP_NAME__, built locally with Kiln.',
    // KILN_MANIFEST_PERMISSIONS_START
    permissions: ['storage'],
    host_permissions: [],
    // KILN_MANIFEST_PERMISSIONS_END
  },
  zip: { name: '__APP_SLUG__' },
});
