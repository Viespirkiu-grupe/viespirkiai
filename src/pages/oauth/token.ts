import type { APIRoute } from 'astro';
import {
  createDummyTokenResponse,
  createOAuthOptionsResponse,
  logDummyOAuthRequest,
} from '@/src/lib/dummyOAuth';

export const POST: APIRoute = ({ request }) => createDummyTokenResponse(request);
export const OPTIONS: APIRoute = ({ request }) => {
  logDummyOAuthRequest('token_preflight', request);
  return createOAuthOptionsResponse();
};
