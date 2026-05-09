import config from '../lib/config.ts';

export async function GET() {
  return Response.redirect(config.analitikaUrl ?? '/', 302);
}
