export function resolveRedirectPath(value, fallbackPath) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized.startsWith('/')) {
    return fallbackPath;
  }
  if (normalized.startsWith('//')) {
    return fallbackPath;
  }
  return normalized;
}

function pickForwardedValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const [firstValue = ''] = value.split(',');
  return firstValue.trim();
}

function getRequestOrigin(request) {
  const forwardedProto = pickForwardedValue(request.headers.get('x-forwarded-proto'));
  const forwardedHost =
    pickForwardedValue(request.headers.get('x-forwarded-host')) ||
    pickForwardedValue(request.headers.get('host'));

  const fallbackUrl = new URL(request.url);
  const protocol = forwardedProto || fallbackUrl.protocol.replace(/:$/, '') || 'https';
  const host = forwardedHost || fallbackUrl.host;

  return `${protocol}://${host}`;
}

export function buildRedirectUrl(request, path, params = {}) {
  const url = new URL(resolveRedirectPath(path, '/'), getRequestOrigin(request));
  url.searchParams.delete('status');
  url.searchParams.delete('error');

  if (params.status) {
    url.searchParams.set('status', params.status);
  }

  if (params.error) {
    url.searchParams.set('error', params.error);
  }

  return url;
}
