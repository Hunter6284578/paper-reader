import { describe, expect, it } from 'vitest';
import { pairingAction } from './pairing';

describe('pairingAction', () => {
  it('offers an explicit development connection without submitting a fixed code', () => {
    expect(pairingAction({ authMode: 'development' })).toEqual({ requiresCode: false, label: '开发模式连接' });
  });

  it('requires a code for paired-device servers', () => {
    expect(pairingAction({ authMode: 'device-pairing' })).toEqual({ requiresCode: true, label: '连接设备' });
  });
});
