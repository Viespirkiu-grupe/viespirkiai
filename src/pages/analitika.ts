import config from '@/config.js';

export async function GET() {
  return Response.redirect((config as any).analitikaUrl, 302);
}
