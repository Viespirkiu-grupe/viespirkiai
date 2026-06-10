import { describe, expect, it } from 'vitest';
import {
  DUMMY_ACCESS_TOKEN,
  DUMMY_AUTHORIZATION_CODE,
  DUMMY_CLIENT_ID,
  createAuthorizationRedirect,
  createAuthorizationServerMetadata,
  createDummyAuthChallenge,
  createDummyClientRegistrationResponse,
  createDummyTokenResponse,
  createProtectedResourceMetadata,
  hasValidDummyBearerToken,
  parseDummyAuthorizationRequest,
} from '../src/lib/dummyOAuth';

const origin = 'https://example.com';

function request(path: string, init?: RequestInit): Request {
  return new Request(`${origin}${path}`, init);
}

describe('dummy OAuth MCP protection', () => {
  it('accepts only the fixed dummy bearer token', () => {
    expect(hasValidDummyBearerToken(request('/mcp/dummyAuth'))).toBe(false);
    expect(hasValidDummyBearerToken(request('/mcp/dummyAuth', {
      headers: { Authorization: `Bearer ${DUMMY_ACCESS_TOKEN}` },
    }))).toBe(true);
    expect(hasValidDummyBearerToken(request('/mcp/dummyAuth', {
      headers: { Authorization: 'Bearer wrong-token' },
    }))).toBe(false);
  });

  it('returns a protected-resource challenge based on the request origin', () => {
    const response = createDummyAuthChallenge(request('/mcp/dummyAuth'));

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp/dummyAuth"',
    );
  });
});

describe('dummy OAuth discovery', () => {
  it('describes the protected MCP resource', async () => {
    const response = createProtectedResourceMetadata(request('/mcp/dummyAuth/.well-known/oauth-protected-resource'));

    expect(await response.json()).toEqual({
      resource: 'https://example.com/mcp/dummyAuth',
      authorization_servers: ['https://example.com/oauth'],
      bearer_methods_supported: ['header'],
    });
  });

  it('describes the dummy authorization server', async () => {
    const response = createAuthorizationServerMetadata(request('/oauth/.well-known/oauth-authorization-server'));

    expect(await response.json()).toEqual({
      issuer: 'https://example.com/oauth',
      authorization_endpoint: 'https://example.com/oauth/authorize',
      token_endpoint: 'https://example.com/oauth/token',
      registration_endpoint: 'https://example.com/oauth/register',
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    });
  });

  it('can describe the authorization server using a legacy MCP-path issuer', async () => {
    const response = createAuthorizationServerMetadata(
      request('/.well-known/oauth-authorization-server/mcp/dummyAuth'),
      '/mcp/dummyAuth',
    );

    expect(await response.json()).toMatchObject({
      issuer: 'https://example.com/mcp/dummyAuth',
      authorization_endpoint: 'https://example.com/oauth/authorize',
      token_endpoint: 'https://example.com/oauth/token',
      registration_endpoint: 'https://example.com/oauth/register',
    });
  });
});

describe('dummy OAuth dynamic client registration', () => {
  it('registers a public authorization-code client', async () => {
    const response = await createDummyClientRegistrationResponse(request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Microsoft Copilot',
        redirect_uris: ['https://client.example/callback'],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      client_id: DUMMY_CLIENT_ID,
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      client_name: 'Microsoft Copilot',
    });
  });

  it('accepts registrations without redirect URIs', async () => {
    const response = await createDummyClientRegistrationResponse(request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [] }),
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ client_id: DUMMY_CLIENT_ID });
  });

  it('accepts native-app custom-scheme redirect URIs', async () => {
    const response = await createDummyClientRegistrationResponse(request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['ms-copilot://oauth/callback'] }),
    }));

    expect(response.status).toBe(201);
  });

  it('always registers a usable public client even when confidential auth was requested', async () => {
    const response = await createDummyClientRegistrationResponse(request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://client.example/callback'],
        token_endpoint_auth_method: 'client_secret_post',
      }),
    }));

    expect(await response.json()).toMatchObject({
      client_id: DUMMY_CLIENT_ID,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  });
});

describe('dummy OAuth authorization', () => {
  it('parses a standard authorization-code and PKCE request', () => {
    const parsed = parseDummyAuthorizationRequest(new URLSearchParams({
      client_id: 'copilot',
      redirect_uri: 'https://client.example/callback',
      response_type: 'code',
      state: 'state-value',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    }));

    expect(parsed).toEqual({
      request: {
        clientId: 'copilot',
        redirectUri: 'https://client.example/callback',
        state: 'state-value',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        resource: null,
      },
    });
  });

  it('rejects unsupported response types and unsafe redirect URI schemes', () => {
    expect(parseDummyAuthorizationRequest(new URLSearchParams({
      client_id: 'copilot',
      redirect_uri: 'javascript:alert(1)',
      response_type: 'code',
    }))).toHaveProperty('error');
    expect(parseDummyAuthorizationRequest(new URLSearchParams({
      client_id: 'copilot',
      redirect_uri: 'https://client.example/callback',
      response_type: 'token',
    }))).toHaveProperty('error');
  });

  it('redirects with the dummy code and preserves state and existing query parameters', () => {
    const response = createAuthorizationRedirect({
      clientId: 'copilot',
      redirectUri: 'https://client.example/callback?existing=yes',
      state: 'state-value',
      codeChallenge: null,
      codeChallengeMethod: null,
      resource: null,
    });
    const location = new URL(response.headers.get('location')!);

    expect(response.status).toBe(302);
    expect(location.searchParams.get('existing')).toBe('yes');
    expect(location.searchParams.get('code')).toBe(DUMMY_AUTHORIZATION_CODE);
    expect(location.searchParams.get('state')).toBe('state-value');
  });
});

describe('dummy OAuth token endpoint', () => {
  it('issues the fixed dummy access token and ignores the PKCE verifier', async () => {
    const response = await createDummyTokenResponse(request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: DUMMY_AUTHORIZATION_CODE,
        code_verifier: 'anything',
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      access_token: DUMMY_ACCESS_TOKEN,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('rejects invalid grants and codes', async () => {
    const invalidGrant = await createDummyTokenResponse(request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', code: DUMMY_AUTHORIZATION_CODE }),
    }));
    const invalidCode = await createDummyTokenResponse(request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'wrong-code' }),
    }));

    expect(invalidGrant.status).toBe(400);
    expect(await invalidGrant.json()).toEqual({ error: 'unsupported_grant_type' });
    expect(invalidCode.status).toBe(400);
    expect(await invalidCode.json()).toEqual({ error: 'invalid_grant' });
  });
});
