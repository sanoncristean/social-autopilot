import { storageService } from './StorageService.js';
import { ActivityLog, LogStatus } from '../types/index.js';

export class LoggingService {
  public async log(params: {
    userId: string;
    automationId?: string;
    operation: ActivityLog['operation'];
    status: LogStatus;
    message: string;
    video?: string;
    videoId?: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<ActivityLog> {
    const logItem: ActivityLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      userId: params.userId,
      automationId: params.automationId,
      timestamp: new Date().toISOString(),
      operation: params.operation,
      status: params.status,
      video: params.video,
      videoId: params.videoId,
      durationMs: params.durationMs,
      message: params.message,
      metadata: params.metadata,
    };

    console.log(`[LOG][${logItem.status}] ${logItem.operation} - ${logItem.message}`);
    await storageService.saveActivityLog(logItem);
    return logItem;
  }
}

export const loggingService = new LoggingService();
