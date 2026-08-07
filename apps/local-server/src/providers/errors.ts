export type ProviderErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_AUTHENTICATION'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_UPSTREAM'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'REQUEST_ABORTED';

export class ProviderError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly retryAfterMs: number | undefined;

  public constructor(
    message: string,
    code: ProviderErrorCode,
    statusCode: number,
    retryable: boolean,
    options: { cause?: unknown; retryAfterMs?: number } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class InvalidProviderResponseError extends ProviderError {
  public constructor(message: string, cause?: unknown) {
    super(message, 'PROVIDER_INVALID_RESPONSE', 502, true, { cause });
    this.name = 'InvalidProviderResponseError';
  }
}

export function providerHttpError(
  status: number,
  detail: string,
  retryAfterMs?: number,
): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(
      'La clé OpenCode Go est absente, invalide ou non autorisée.',
      'PROVIDER_AUTHENTICATION',
      401,
      false,
      { cause: detail },
    );
  }
  if (status === 429) {
    return new ProviderError(
      'La limite de requêtes OpenCode Go est atteinte. Réessayez dans un instant.',
      'PROVIDER_RATE_LIMIT',
      429,
      true,
      { cause: detail, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
    );
  }
  if (status >= 500) {
    return new ProviderError(
      `OpenCode Go est temporairement indisponible (HTTP ${status}).`,
      'PROVIDER_UPSTREAM',
      503,
      true,
      { cause: detail },
    );
  }
  return new ProviderError(
    `OpenCode Go a refusé la requête (HTTP ${status}).`,
    'PROVIDER_UPSTREAM',
    502,
    false,
    { cause: detail },
  );
}
