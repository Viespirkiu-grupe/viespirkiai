export const DUMMY_AUTHORIZATION_CODE = 'dummy-code';
export const DUMMY_ACCESS_TOKEN = 'dummy-token';
export const DUMMY_CLIENT_ID = 'dummy-client';

export interface DummyAuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  resource: string | null;
}

function oauthLog(event: string, request: Request, details: Record<string, unknown> = {}): void {
  const url = new URL(request.url);
  console.log(JSON.stringify({
    type: 'dummy-oauth',
    event,
    method: request.method,
    path: url.pathname,
    userAgent: request.headers.get('user-agent'),
    ...details,
  }));
}

function getOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || requestUrl.host;
  let protocol = forwardedProto || requestUrl.protocol.replace(':', '');
  const hostname = host.split(':')[0].toLowerCase();

  if (protocol === 'http' && hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
    protocol = 'https';
  }

  return `${protocol}://${host}`;
}

function oauthJson(body: object, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function protectedResourceMetadataUrl(request: Request): string {
  return `${getOrigin(request)}/.well-known/oauth-protected-resource/mcp/dummyAuth`;
}

export function createDummyAuthChallenge(request: Request): Response {
  oauthLog('mcp_challenge', request, {
    hasAuthorizationHeader: request.headers.has('authorization'),
    resourceMetadata: protectedResourceMetadataUrl(request),
  });

  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      'WWW-Authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl(request)}"`,
    },
  });
}

export function hasValidDummyBearerToken(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${DUMMY_ACCESS_TOKEN}`;
}

export function createProtectedResourceMetadata(request: Request): Response {
  const origin = getOrigin(request);
  oauthLog('protected_resource_metadata', request, {
    resource: `${origin}/mcp/dummyAuth`,
    authorizationServer: `${origin}/oauth`,
  });

  return oauthJson({
    resource: `${origin}/mcp/dummyAuth`,
    authorization_servers: [`${origin}/oauth`],
    bearer_methods_supported: ['header'],
  });
}

export function createAuthorizationServerMetadata(request: Request, issuerPath = '/oauth'): Response {
  const origin = getOrigin(request);
  oauthLog('authorization_server_metadata', request, {
    issuer: `${origin}${issuerPath}`,
  });

  return oauthJson({
    issuer: `${origin}${issuerPath}`,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
  });
}

export function createOAuthOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function createDummyClientRegistrationResponse(request: Request): Promise<Response> {
  let registration: Record<string, unknown> = {};
  try {
    registration = await request.json();
  } catch {}
  oauthLog('client_registration', request, {
    clientName: typeof registration.client_name === 'string' ? registration.client_name : null,
    applicationType: typeof registration.application_type === 'string' ? registration.application_type : null,
    redirectUriCount: Array.isArray(registration.redirect_uris) ? registration.redirect_uris.length : 0,
    requestedTokenAuthMethod:
      typeof registration.token_endpoint_auth_method === 'string'
        ? registration.token_endpoint_auth_method
        : null,
  });

  return oauthJson({
    ...registration,
    client_id: DUMMY_CLIENT_ID,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_name: typeof registration.client_name === 'string' ? registration.client_name : 'Dummy MCP OAuth client',
  }, 201);
}

function isValidRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return !['javascript:', 'data:', 'file:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export function parseDummyAuthorizationRequest(params: URLSearchParams | FormData):
  | { request: DummyAuthorizationRequest; error?: never }
  | { request?: never; error: string } {
  const clientId = String(params.get('client_id') ?? '');
  const redirectUri = String(params.get('redirect_uri') ?? '');
  const responseType = String(params.get('response_type') ?? '');
  const state = params.get('state');
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');
  const resource = params.get('resource');

  if (!clientId) return { error: 'Trūksta client_id parametro.' };
  if (!isValidRedirectUri(redirectUri)) return { error: 'redirect_uri turi būti galiojantis absoliutus URL.' };
  if (responseType !== 'code') return { error: 'Palaikomas tik response_type=code.' };
  if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
    return { error: 'Palaikomas tik code_challenge_method=S256.' };
  }

  return {
    request: {
      clientId,
      redirectUri,
      state: state === null ? null : String(state),
      codeChallenge: codeChallenge === null ? null : String(codeChallenge),
      codeChallengeMethod: codeChallengeMethod === null ? null : String(codeChallengeMethod),
      resource: resource === null ? null : String(resource),
    },
  };
}

export function createAuthorizationRedirect(request: DummyAuthorizationRequest): Response {
  const redirectUrl = new URL(request.redirectUri);
  redirectUrl.searchParams.set('code', DUMMY_AUTHORIZATION_CODE);
  if (request.state !== null) redirectUrl.searchParams.set('state', request.state);

  return Response.redirect(redirectUrl, 302);
}

export async function createDummyTokenResponse(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    oauthLog('token_error', request, { error: 'invalid_request' });
    return oauthJson({ error: 'invalid_request', error_description: 'Tikėtasi form-urlencoded užklausos.' }, 400);
  }

  if (formData.get('grant_type') !== 'authorization_code') {
    oauthLog('token_error', request, {
      error: 'unsupported_grant_type',
      grantType: formData.get('grant_type'),
    });
    return oauthJson({ error: 'unsupported_grant_type' }, 400);
  }
  if (formData.get('code') !== DUMMY_AUTHORIZATION_CODE) {
    oauthLog('token_error', request, { error: 'invalid_grant' });
    return oauthJson({ error: 'invalid_grant' }, 400);
  }
  oauthLog('token_issued', request, {
    grantType: 'authorization_code',
    hasCodeVerifier: formData.has('code_verifier'),
    hasResource: formData.has('resource'),
  });

  return oauthJson({
    access_token: DUMMY_ACCESS_TOKEN,
    token_type: 'Bearer',
    expires_in: 3600,
  });
}

export function logDummyOAuthRequest(
  event: string,
  request: Request,
  details: Record<string, unknown> = {},
): void {
  oauthLog(event, request, details);
}
