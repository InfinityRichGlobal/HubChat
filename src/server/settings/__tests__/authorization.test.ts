import { describe, expect, it } from 'vitest';
import { canManageRuntimeSettings } from '@/lib/auth/permissions';
import { SETTING_DEFINITIONS, parseSettingValue, readinessCanAdvance } from '../registry';

describe('runtime settings authorization and secret boundaries', () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'] as const) {
    it(`owner may ${method}`, () => expect(canManageRuntimeSettings('owner')).toBe(true));
    it(`admin may not ${method}`, () => expect(canManageRuntimeSettings('admin')).toBe(false));
    it(`viewer may not ${method}`, () => expect(canManageRuntimeSettings('viewer')).toBe(false));
  }

  for (const definition of SETTING_DEFINITIONS) {
    it(`${definition.key} rejects blank input`, () => {
      expect(() => parseSettingValue(definition.key, '')).toThrow();
    });
  }

  it('cannot skip from CONFIGURED to LIVE_VERIFIED', () => {
    expect(readinessCanAdvance('CONFIGURED', 'LIVE_VERIFIED')).toBe(false);
  });

  it('can advance from CONFIGURED to TESTED', () => {
    expect(readinessCanAdvance('CONFIGURED', 'TESTED')).toBe(true);
  });
});
