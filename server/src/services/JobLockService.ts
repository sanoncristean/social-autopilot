import { storageService } from './StorageService.js';
import { JobLock } from '../types/index.js';

export class JobLockService {
  public async acquireLock(
    automationId: string,
    jobType: string = 'PROCESS_VIDEO',
    leaseDurationMs: number = 900000,
    workerId: string = 'worker_primary'
  ): Promise<boolean> {
    return await storageService.acquireJobLock(automationId, jobType, leaseDurationMs, workerId);
  }

  public async releaseLock(automationId: string): Promise<void> {
    await storageService.releaseJobLock(automationId);
  }

  public async getActiveLocks(): Promise<JobLock[]> {
    return await storageService.getActiveJobLocks();
  }
}

export const jobLockService = new JobLockService();
