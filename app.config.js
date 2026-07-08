// Dynamic config layer over app.json. Its only job is to pick the CloudKit
// environment (Development vs Production) per EAS build profile, since a static
// app.json can't vary entitlements between builds.
//
// CloudKit auto-creates record types only in the Development environment;
// Production requires an explicit schema deploy. So test/dev builds must target
// Development, and only release builds (TestFlight/App Store) target Production.
// Set CLOUDKIT_ENV in each eas.json profile's env. When unset (e.g. a plain
// `expo start` with no build), the entitlement is omitted and CloudKit falls
// back to its default for the build type.
module.exports = ({ config }) => {
  const cloudkitEnv = process.env.CLOUDKIT_ENV; // 'Development' | 'Production'
  if (cloudkitEnv) {
    config.ios = config.ios || {};
    config.ios.entitlements = {
      ...(config.ios.entitlements || {}),
      'com.apple.developer.icloud-container-environment': cloudkitEnv,
    };
  }
  return config;
};
