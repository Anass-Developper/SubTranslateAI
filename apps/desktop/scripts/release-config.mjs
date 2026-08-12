export function resolveUpdateUrl(environment) {
  const explicit = environment.SUBTRANSLATE_UPDATE_URL?.trim();
  if (explicit) {
    const url = new URL(explicit);
    if (url.protocol !== 'https:') throw new Error('SUBTRANSLATE_UPDATE_URL doit utiliser HTTPS.');
    return url.toString().replace(/\/$/u, '');
  }

  // Never fall back to GITHUB_REPOSITORY. Updates must come from the dedicated,
  // binary-only repository so latest.yml and the installer stay together.
  const repository = environment.RELEASES_REPOSITORY?.trim();
  if (repository && /^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    return `https://github.com/${repository}/releases/latest/download`;
  }
  return '';
}
