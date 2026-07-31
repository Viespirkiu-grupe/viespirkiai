import { describe, expect, it } from 'vitest';
import { configFromEnv } from '@/utils/configEnv.js';
import { normalizeConfig } from '@/utils/configSchema.js';

describe('optional server features', () => {
  it('keeps request logging and ATN-1 pages disabled by default', () => {
    const config = normalizeConfig({});

    expect(config.logRequests).toBe(false);
    expect(config.enableAtn1).toBe(false);
  });

  it('reads request logging and ATN-1 switches from environment variables', () => {
    const config = normalizeConfig(configFromEnv({
      LOG_REQUESTS: 'true',
      ENABLE_ATN1: '1',
    }));

    expect(config.logRequests).toBe(true);
    expect(config.enableAtn1).toBe(true);
  });
});

describe('external source URLs', () => {
  it('reads the CPVA ES investments mirror from the environment', () => {
    const config = normalizeConfig(configFromEnv({
      '2021_ESINVESTICIJOS': 'http://10.1.10.1:9204/',
    }));

    expect(config.esInvesticijos2021Url).toBe('http://10.1.10.1:9204/');
  });

  it('uses the public CPVA source by default', () => {
    expect(normalizeConfig({}).esInvesticijos2021Url)
      .toBe('https://2021.esinvesticijos.lt');
  });
});
