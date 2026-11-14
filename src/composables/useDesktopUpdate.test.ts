import { describe, it, expect, vi, beforeEach } from 'vitest';

const check = vi.fn();
const relaunch = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));

type Ev = { event: 'Started'; data: { contentLength?: number } } | { event: 'Progress'; data: { chunkLength: number } } | { event: 'Finished' };

function fakeUpdate(version: string, run: (emit: (e: Ev) => void) => Promise<void> = async () => {}) {
  return {
    version,
    currentVersion: '0.2.1',
    close: vi.fn(async () => {}),
    downloadAndInstall: vi.fn(async (onEvent: (e: Ev) => void) => run(onEvent)),
  };
}

// module-level state, so each test gets a fresh copy
async function load() {
  vi.resetModules();
  return (await import('./useDesktopUpdate')).useDesktopUpdate();
}

beforeEach(() => {
  check.mockReset();
  relaunch.mockReset();
});

describe('useDesktopUpdate', () => {
  it('offers nothing when the server has no update', async () => {
    check.mockResolvedValue(null);
    const u = await load();
    await u.checkForUpdate();
    expect(u.available.value).toBeNull();
  });

  it('stays quiet when offline', async () => {
    check.mockRejectedValue(new Error('error sending request'));
    const u = await load();
    await u.checkForUpdate();
    expect(u.available.value).toBeNull();
    expect(u.phase.value).toBe('idle');
  });

  it('offers an older version too, since a rollback is just a different Latest', async () => {
    check.mockResolvedValue(fakeUpdate('0.2.0'));
    const u = await load();
    await u.checkForUpdate();
    expect(u.available.value).toBe('0.2.0');
  });

  it('downloads only on install, reports progress, then relaunches', async () => {
    let seen: number | null = null;
    let u!: Awaited<ReturnType<typeof load>>;
    const update = fakeUpdate('0.2.2', async (emit) => {
      emit({ event: 'Started', data: { contentLength: 200 } });
      emit({ event: 'Progress', data: { chunkLength: 50 } });
      seen = u.progress.value;
      emit({ event: 'Progress', data: { chunkLength: 150 } });
      emit({ event: 'Finished' });
    });
    check.mockResolvedValue(update);
    u = await load();
    await u.checkForUpdate();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();

    await u.install();
    expect(seen).toBe(0.25);
    expect(u.progress.value).toBe(1);
    expect(u.phase.value).toBe('restarting');
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('shows a failure and allows a retry', async () => {
    const update = fakeUpdate('0.2.2', async () => {
      throw new Error('signature mismatch');
    });
    check.mockResolvedValue(update);
    const u = await load();
    await u.checkForUpdate();
    await u.install();
    expect(u.phase.value).toBe('failed');
    expect(relaunch).not.toHaveBeenCalled();

    await u.install();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it('Later hides it until the next check offers it again', async () => {
    check.mockResolvedValue(fakeUpdate('0.2.2'));
    const u = await load();
    await u.checkForUpdate();
    u.dismiss();
    expect(u.available.value).toBeNull();

    await u.checkForUpdate();
    expect(u.available.value).toBe('0.2.2');
  });
});
