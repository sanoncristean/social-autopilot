import {
  SocialPlatformAdapter,
  PublishMediaParams,
  PublishResult,
  MediaValidationResult,
  ConnectionValidationResult,
} from './SocialPlatformAdapter.js';
import {
  SocialPlatform,
  PlatformCapabilities,
  SocialAccount,
  ContentItem,
  XPlatformContent,
} from '../types/index.js';
import { storageService } from '../services/StorageService.js';

export class XAdapter implements SocialPlatformAdapter {
  readonly platform: SocialPlatform = 'x';

  getCapabilities(): PlatformCapabilities {
    return {
      platform: 'x',
      displayName: 'X (Twitter)',
      supportsVideo: true,
      supportsImages: true,
      supportsMultipleImages: true,
      supportsScheduling: true,
      supportsDirectPublishing: true,
      supportsCaptions: true,
      supportsHashtags: true,
      supportsTitle: false,
      supportsDescription: false,
      supportsTags: false,
      supportsCarousel: false,
      maxFileSizeMB: 512,
      supportedFormats: ['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      aspectRatios: ['16:9', '1:1', '9:16'],
      maxCaptionLength: 280,
      requiresSpecialPermissions: false,
      notes: 'Posts tweets using X API v2 (tweet.read, tweet.write, users.read scopes).',
    };
  }

  async validateConnection(account: SocialAccount): Promise<ConnectionValidationResult> {
    const creds = storageService.getSocialCredentials(account.id);
    if (!creds || !creds.encryptedAccessToken) {
      return {
        valid: false,
        error: 'X account authorization expired or missing. Please reconnect your X account.',
        requiresReauth: true,
      };
    }
    return {
      valid: true,
      accountDetails: {
        accountName: account.accountName,
        accountIdentifier: account.accountIdentifier,
        avatarUrl: account.avatarUrl,
      },
    };
  }

  async validateMedia(content: ContentItem): Promise<MediaValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content.mediaUrls || content.mediaUrls.length === 0) {
      errors.push('No media attached for X post.');
    }

    if (content.contentType === 'image_set' && content.mediaUrls.length > 4) {
      warnings.push('X supports up to 4 images per tweet. Additional images will be omitted.');
    }

    if (content.contentType === 'video' && (content.durationSeconds || 0) > 140) {
      warnings.push('Videos longer than 2 minutes 20 seconds require X Premium subscriber credentials.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async publish(params: PublishMediaParams): Promise<PublishResult> {
    const { account, content, platformContent } = params;

    const validation = await this.validateMedia(content);
    if (!validation.valid) {
      return {
        success: false,
        error: `X media validation error: ${validation.errors.join(', ')}`,
      };
    }

    const connValidation = await this.validateConnection(account);
    if (!connValidation.valid) {
      return {
        success: false,
        error: connValidation.error,
        requiresReauth: connValidation.requiresReauth,
      };
    }

    const xContent: XPlatformContent =
      platformContent ||
      content.platformContent?.x || {
        postText: content.masterAnalysis?.contentSummary || content.title,
        hashtags: content.masterAnalysis?.keywords || [],
        cta: content.masterAnalysis?.callToAction || '',
      };

    let fullText = xContent.postText || '';
    if (xContent.hashtags && xContent.hashtags.length > 0) {
      const hashStr = xContent.hashtags
        .slice(0, 3)
        .map((h) => (h.startsWith('#') ? h : `#${h}`))
        .join(' ');
      fullText += ` ${hashStr}`;
    }
    if (xContent.cta) {
      fullText += `\n${xContent.cta}`;
    }

    if (fullText.length > 280) {
      fullText = fullText.substring(0, 277) + '...';
    }

    const creds = storageService.getSocialCredentials(account.id);
    const envToken = process.env.X_BEARER_TOKEN || process.env.TWITTER_ACCESS_TOKEN;
    const token = creds?.encryptedAccessToken || envToken;

    if (!token || token.includes('mock') || token.length < 10) {
      return {
        success: false,
        error: 'X publishing requires a valid User OAuth 2.0 Access Token with tweet.write scope.',
        requiresReauth: true,
      };
    }

    try {
      const res = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: fullText,
        }),
      });

      const data = (await res.json()) as any;

      if (!res.ok || data.errors) {
        const errorDetail = data.errors?.[0]?.message || data.detail || 'X API v2 error';
        if (res.status === 401) {
          return {
            success: false,
            error: 'X access token expired. Re-authentication required.',
            requiresReauth: true,
          };
        }
        if (res.status === 429) {
          return {
            success: false,
            error: 'X API rate limit exceeded. Retry scheduled.',
            rateLimited: true,
            retryAfterSeconds: 900,
          };
        }
        return {
          success: false,
          error: `X error: ${errorDetail}`,
        };
      }

      const tweetId = data.data?.id;
      return {
        success: true,
        remotePostId: tweetId,
        publishedUrl: `https://x.com/${encodeURIComponent(account.accountIdentifier)}/status/${tweetId}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `X request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
