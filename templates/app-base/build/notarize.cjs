const { notarize } = require('@electron/notarize');

module.exports = async function notarizeApp(context) {
  if (process.platform !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  await notarize({
    appBundleId: '__APP_ID__',
    appPath: `${context.appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
