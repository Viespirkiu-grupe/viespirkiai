import type { APIRoute } from 'astro';
import { gautiStatistika, buildPrometheusMetrics } from '@/modules/statistika/statistika.js';

// Prometheus scrape endpoint – eksponuoja visą /statistika puslapio informaciją
// text exposition formatu (version 0.0.4).
export const GET: APIRoute = async () => {
  const statistika = await gautiStatistika();
  const body = buildPrometheusMetrics(statistika);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
    },
  });
};
