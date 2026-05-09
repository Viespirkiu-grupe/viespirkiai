import type { APIRoute } from 'astro';
import { gautiStatistika } from '@/modules/statistika/statistika.js';

export const GET: APIRoute = async () => {
  const statistika = await gautiStatistika();
  return Response.json(statistika);
};
