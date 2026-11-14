import { db } from '@/core/db/schema';
import { logger } from '@/core/logging/logger';
import { syncEngine } from './index';
import { resetDeviceIdCache } from './deviceId';

const log = logger.scoped('sync');

// The device id lives in this database and must go too, or sync_pull would withhold this device's own ops.
export async function resetDevice(reload: () => void = () => location.reload()): Promise<void> {
  syncEngine.stop();
  log.info('resetting this device: deleting the local database');
  await db.delete();
  resetDeviceIdCache();
  reload();
}
