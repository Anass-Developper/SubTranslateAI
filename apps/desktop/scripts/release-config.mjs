export function resolveUpdateUrl(environment) {
  const explicit = environment.SUBTRANSLATE_UPDATE_URL?.trim();
  if (explicit) {
    const url = new URL(explicit);
    if (url.protocol !== 'https:') throw new Error('SUBTRANSLATE_UPDATE_URL doit utiliser HTTPS.');
    return url.toString().replace(/\/$/u, '');
  }

  // Never fall back to GITHUB_REPOSITORY: that repository contains the private
  // sources. Updates must come from the separate, binary-only repository.
  const repository = environment.RELEASES_REPOSITORY?.trim();
  if (repository && /^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    return `https://github.com/${repository}/releases/latest/download`;
  }
  return '';
}
