import type { APIRoute } from 'astro';
import {
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  logDummyOAuthRequest,
} from '@/src/lib/dummyOAuth';

export const GET: APIRoute = ({ params, request }) => {
  if (params.wellKnown === '.well-known/oauth-authorization-server/oauth') {
    return createAuthorizationServerMetadata(request);
  }

  if (
    params.wellKnown === '.well-known/oauth-authorization-server/mcp/dummyAuth' ||
    params.wellKnown === '.well-known/openid-configuration/mcp/dummyAuth'
  ) {
    return createAuthorizationServerMetadata(request, '/mcp/dummyAuth');
  }

  if (params.wellKnown === '.well-known/openid-configuration/oauth') {
    return createAuthorizationServerMetadata(request);
  }

  if (params.wellKnown === '.well-known/oauth-protected-resource/mcp/dummyAuth') {
    return createProtectedResourceMetadata(request);
  }

  if (params.wellKnown?.startsWith('.well-known/')) {
    logDummyOAuthRequest('unknown_well_known_request', request, {
      requestedDiscoveryPath: params.wellKnown,
    });
  }

  return new Response('Not Found', { status: 404 });
};
