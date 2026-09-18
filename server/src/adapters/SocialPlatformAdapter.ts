import {
  SocialPlatform,
  PlatformCapabilities,
  SocialAccount,
  ContentItem,
  PlatformSpecificContentMap,
} from '../types/index.js';

export interface PublishMediaParams {
  account: SocialAccount;
  content: ContentItem;
  platformContent?: any;
  accessToken?: string;
}

export interface PublishResult {
  success: boolean;
  remotePostId?: string;
  publishedUrl?: string;
  error?: string;
  requiresReauth?: boolean;
  rateLimited?: boolean;
  retryAfterSeconds?: number;
}

export interface MediaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConnectionValidationResult {
  valid: boolean;
  error?: string;
  requiresReauth?: boolean;
  accountDetails?: {
    accountName?: string;
    accountIdentifier?: string;
    avatarUrl?: string;
  };
}

export interface SocialPlatformAdapter {
  readonly platform: SocialPlatform;
  getCapabilities(): PlatformCapabilities;
  validateConnection(account: SocialAccount, credentials?: any): Promise<ConnectionValidationResult>;
  validateMedia(content: ContentItem): Promise<MediaValidationResult>;
  publish(params: PublishMediaParams): Promise<PublishResult>;
  getPublishingStatus?(remotePostId: string, account: SocialAccount): Promise<any>;
  deletePublishedContent?(remotePostId: string, account: SocialAccount): Promise<boolean>;
}
