import type { APIRoute } from 'astro';
import {
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  logDummyOAuthRequest,
} from '@/src/lib/dummyOAuth';

export const GET: APIRoute = ({ params, request }) => {
  if (params.wellKnown === 'oauth-authorization-server/oauth') {
    return createAuthorizationServerMetadata(request);
  }

  if (
    params.wellKnown === 'oauth-authorization-server/mcp/dummyAuth' ||
    params.wellKnown === 'openid-configuration/mcp/dummyAuth'
  ) {
    return createAuthorizationServerMetadata(request, '/mcp/dummyAuth');
  }

  if (params.wellKnown === 'openid-configuration/oauth') {
    return createAuthorizationServerMetadata(request);
  }

  if (params.wellKnown === 'oauth-protected-resource/mcp/dummyAuth') {
    return createProtectedResourceMetadata(request);
  }

  logDummyOAuthRequest('unknown_well_known_request', request, {
    requestedDiscoveryPath: `/.well-known/${params.wellKnown ?? ''}`,
  });

  return new Response('Not Found', { status: 404 });
};
