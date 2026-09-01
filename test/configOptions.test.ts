import { describe, expect, it } from 'vitest';
import { configFromEnv } from '@/utils/configEnv.js';
import { normalizeConfig } from '@/utils/configSchema.js';

describe('optional server features', () => {
  it('keeps optional server features disabled by default', () => {
    const config = normalizeConfig({});

    expect(config.logRequests).toBe(false);
    expect(config.enableAtn1).toBe(false);
    expect(config.enableBotChallenge).toBe(false);
  });

  it('reads optional server switches from environment variables', () => {
    const config = normalizeConfig(configFromEnv({
      LOG_REQUESTS: 'true',
      ENABLE_ATN1: '1',
      ENABLE_BOT_CHALLENGE: 'yes',
    }));

    expect(config.logRequests).toBe(true);
    expect(config.enableAtn1).toBe(true);
    expect(config.enableBotChallenge).toBe(true);
  });
});

describe('external source URLs', () => {
  it('reads the KOTIS mirror from the environment', () => {
    const config = normalizeConfig(configFromEnv({
      KOTIS_URL: 'http://kotis-proxy.test:8080',
    }));

    expect(config.kotisUrl).toBe('http://kotis-proxy.test:8080');
  });

  it('uses the public KOTIS host by default', () => {
    expect(normalizeConfig({}).kotisUrl).toBe('https://kotis.kt.gov.lt');
  });

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

describe('e-Seimas scraper options', () => {
  it('reads independent scheduling limits while sharing the e-TAR adapter address', () => {
    const config = normalizeConfig(configFromEnv({
      ETAR_API_URL: 'http://adapter.test',
      ETAR_API_KEY: 'secret',
      ESEIMAS_RECENT_DAYS: '90',
      ESEIMAS_REFRESH_HOURS: '4',
      ESEIMAS_MAX_INFLIGHT: '3',
    }));

    expect(config.eTarApiUrl).toBe('http://adapter.test');
    expect(config.eTarApiKey).toBe('secret');
    expect(config.eSeimasRecentDays).toBe(90);
    expect(config.eSeimasRefreshHours).toBe(4);
    expect(config.eSeimasMaxInflight).toBe(3);
  });
});

describe('SQLite sidecar locations', () => {
  it('reads the one sidecar directory and remote base from the environment', () => {
    const config = normalizeConfig(configFromEnv({
      SIDECAR_DIR: '/data/sidecars',
      SIDECAR_REMOTE: 'https://host',
    }));

    expect(config.sidecarDir).toBe('/data/sidecars');
    expect(config.sidecarRemote).toBe('https://host');
  });

  it('leaves both unset when the environment does not define them', () => {
    const config = normalizeConfig(configFromEnv({}));

    expect(config.sidecarDir).toBeUndefined();
    expect(config.sidecarRemote).toBeUndefined();
  });
});
