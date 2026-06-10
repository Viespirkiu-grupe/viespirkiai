import type { APIRoute } from 'astro';
import {
  createDummyClientRegistrationResponse,
  createOAuthOptionsResponse,
  logDummyOAuthRequest,
} from '@/src/lib/dummyOAuth';

export const POST: APIRoute = ({ request }) => createDummyClientRegistrationResponse(request);
export const OPTIONS: APIRoute = ({ request }) => {
  logDummyOAuthRequest('client_registration_preflight', request);
  return createOAuthOptionsResponse();
};
