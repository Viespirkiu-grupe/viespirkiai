import { describe, expect, it } from 'vitest';
import { isAtn1Path } from '@/src/lib/featureRoutes.ts';

describe('ATN-1 feature routes', () => {
  it.each([
    '/atn1',
    '/atn1/123',
    '/cvpp/ataskaitos',
    '/cvpp/ataskaitos/2024-123',
    '/cvpp/ataskaitos/atn1/123.json',
  ])('recognizes %s', (pathname) => {
    expect(isAtn1Path(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/cvpp',
    '/cvpp/ataskaitos-old',
    '/atn10',
  ])('does not hide unrelated path %s', (pathname) => {
    expect(isAtn1Path(pathname)).toBe(false);
  });
});
