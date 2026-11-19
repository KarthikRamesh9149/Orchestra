// Release pins for the standalone Mac runtimes (not Electron's embedded Node).
export const nativeVersions = Object.freeze({ node: '24.22.3', postgres: '17.12', pgvector: '0.8.7', openssl: '3.5.9' });
export const nativeSources = Object.freeze([
  Object.freeze({name: `postgresql-${nativeVersions.postgres}`, url: `https://ftp.postgresql.org/pub/source/v${nativeVersions.postgres}/postgresql-${nativeVersions.postgres}.tar.bz2`, sha256: '9cf136a703d8ee2f83465c43be4e9e8e7930c82b0bfba13be7e2537be769ac55'}),
  Object.freeze({name: `openssl-${nativeVersions.openssl}`, url: `https://github.com/openssl/openssl/releases/download/openssl-${nativeVersions.openssl}/openssl-${nativeVersions.openssl}.tar.gz`, sha256: '603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a'}),
  Object.freeze({name: `pgvector-${nativeVersions.pgvector}`, url: `https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v${nativeVersions.pgvector}`, sha256: 'cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85'}),
]);
export const nodeArchiveSha256 = 'ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd';

export function assertNativeBuildPins(provenance) {
  if (provenance?.platform !== 'darwin-arm64' || provenance.inputPolicy !== 'fresh-extraction-no-built-cache' ||
      ['postgres', 'pgvector', 'openssl'].some(key => provenance[key] !== nativeVersions[key]) ||
      !Array.isArray(provenance.sources) || provenance.sources.length !== nativeSources.length ||
      !nativeSources.every(pin => provenance.sources.some(input =>
        input?.name === pin.name && input.url === pin.url && input.sha256 === pin.sha256))) {
    throw new Error('Native build provenance does not match the release pins. Rebuild with build-native-mac.mjs before preparing the package.');
  }
}

export function assertNativePackagePins(manifest) {
  if (manifest?.platform !== 'darwin-arm64' || Object.entries(nativeVersions).some(([key, version]) => manifest[key] !== version)) {
    throw new Error('Prepared runtime does not match the release pins. Run prepare-native.mjs before packaging.');
  }
}
