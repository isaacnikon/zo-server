import { NextResponse } from 'next/server';

const SIGNUP_SUBDOMAIN = 'signup';
const ADMIN_SUBDOMAIN = 'admin';

function pickForwardedValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const [firstValue = ''] = value.split(',');
  return firstValue.trim();
}

function getRequestHost(request) {
  return (
    pickForwardedValue(request.headers.get('x-forwarded-host')) ||
    pickForwardedValue(request.headers.get('host'))
  );
}

function getForwardedProto(request) {
  return (
    pickForwardedValue(request.headers.get('x-forwarded-proto')) ||
    request.nextUrl.protocol.replace(/:$/, '') ||
    'http'
  );
}

function splitHostPort(host) {
  const normalizedHost = String(host || '').trim();
  const lastColonIndex = normalizedHost.lastIndexOf(':');

  if (lastColonIndex < 1 || normalizedHost.includes(']')) {
    return { hostname: normalizedHost, port: '' };
  }

  const port = normalizedHost.slice(lastColonIndex + 1);
  if (!/^\d+$/.test(port)) {
    return { hostname: normalizedHost, port: '' };
  }

  return {
    hostname: normalizedHost.slice(0, lastColonIndex),
    port,
  };
}

function getPortalSubdomain(host) {
  const { hostname } = splitHostPort(host);
  const normalizedHostname = hostname.toLowerCase();

  if (
    normalizedHostname === SIGNUP_SUBDOMAIN ||
    normalizedHostname.startsWith(`${SIGNUP_SUBDOMAIN}.`)
  ) {
    return SIGNUP_SUBDOMAIN;
  }

  if (
    normalizedHostname === ADMIN_SUBDOMAIN ||
    normalizedHostname.startsWith(`${ADMIN_SUBDOMAIN}.`)
  ) {
    return ADMIN_SUBDOMAIN;
  }

  return '';
}

function replacePortalSubdomain(host, targetSubdomain) {
  const { hostname, port } = splitHostPort(host);
  const normalizedHostname = hostname.toLowerCase();
  let targetHostname = '';

  if (
    normalizedHostname === SIGNUP_SUBDOMAIN ||
    normalizedHostname.startsWith(`${SIGNUP_SUBDOMAIN}.`)
  ) {
    targetHostname = `${targetSubdomain}${hostname.slice(SIGNUP_SUBDOMAIN.length)}`;
  } else if (
    normalizedHostname === ADMIN_SUBDOMAIN ||
    normalizedHostname.startsWith(`${ADMIN_SUBDOMAIN}.`)
  ) {
    targetHostname = `${targetSubdomain}${hostname.slice(ADMIN_SUBDOMAIN.length)}`;
  }

  if (!targetHostname) {
    return '';
  }

  return port ? `${targetHostname}:${port}` : targetHostname;
}

function buildRedirectUrl(request, { host, pathname }) {
  const url = new URL(request.url);
  url.protocol = `${getForwardedProto(request)}:`;
  if (host) {
    url.host = host;
  }
  url.pathname = pathname;
  return url;
}

function rewriteTo(request, pathname) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
}

function redirectTo(request, { host, pathname }) {
  return NextResponse.redirect(buildRedirectUrl(request, { host, pathname }));
}

export function middleware(request) {
  const currentHost = getRequestHost(request);
  const currentSubdomain = getPortalSubdomain(currentHost);

  if (!currentSubdomain) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (currentSubdomain === SIGNUP_SUBDOMAIN) {
    if (pathname === '/') {
      return rewriteTo(request, '/signup');
    }

    if (pathname === '/signup') {
      return redirectTo(request, { pathname: '/' });
    }

    if (pathname === '/admin') {
      const adminHost = replacePortalSubdomain(currentHost, ADMIN_SUBDOMAIN);
      if (adminHost) {
        return redirectTo(request, { host: adminHost, pathname: '/' });
      }
    }
  }

  if (currentSubdomain === ADMIN_SUBDOMAIN) {
    if (pathname === '/') {
      return rewriteTo(request, '/admin');
    }

    if (pathname === '/admin') {
      return redirectTo(request, { pathname: '/' });
    }

    if (pathname === '/signup') {
      const signupHost = replacePortalSubdomain(currentHost, SIGNUP_SUBDOMAIN);
      if (signupHost) {
        return redirectTo(request, { host: signupHost, pathname: '/' });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/signup', '/admin'],
};
