import type { APIRoute } from 'astro';
import { searchOgImageResponse } from '../lib/searchOgImage.ts';

export const GET: APIRoute = ({ url }) => searchOgImageResponse(url, '/dokumentai', '/dokumentai.png');
