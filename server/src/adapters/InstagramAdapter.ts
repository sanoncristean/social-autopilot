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
  InstagramPlatformContent,
} from '../types/index.js';
import { storageService } from '../services/StorageService.js';

export class InstagramAdapter implements SocialPlatformAdapter {
  readonly platform: SocialPlatform = 'instagram';

  getCapabilities(): PlatformCapabilities {
    return {
      platform: 'instagram',
      displayName: 'Instagram',
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
      supportsCarousel: true,
      maxFileSizeMB: 100,
      supportedFormats: ['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png'],
      aspectRatios: ['9:16', '1:1', '4:5'],
      maxCaptionLength: 2200,
      requiresSpecialPermissions: true,
      notes: 'Requires Instagram Professional/Business account connected to a Facebook Page via Meta Graph API.',
    };
  }

  async validateConnection(account: SocialAccount): Promise<ConnectionValidationResult> {
    const creds = storageService.getSocialCredentials(account.id);
    if (!creds || !creds.encryptedAccessToken) {
      return {
        valid: false,
        error: 'Instagram account requires authorization. Click Reconnect to link via Meta Graph API.',
        requiresReauth: true,
      };
    }

    if (account.connectionStatus === 'PERMISSION_ERROR') {
      return {
        valid: false,
        error: 'Instagram Business account permissions missing. Please grant instagram_content_publish and pages_read_engagement scopes.',
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

    if (content.contentType === 'image_set' && (!content.mediaUrls || content.mediaUrls.length > 5)) {
      errors.push('Instagram carousel upload supports up to 5 images per batch.');
    }

    if (content.contentType === 'video') {
      if (content.fileSizeBytes > 100 * 1024 * 1024) {
        errors.push('Video exceeds Instagram 100MB limit for API container upload.');
      }
      if (content.aspectRatio && content.aspectRatio !== '9:16' && content.aspectRatio !== '1:1' && content.aspectRatio !== '4:5') {
        warnings.push(`Aspect ratio ${content.aspectRatio} might be auto-cropped. Recommended: 9:16 for Reels or 1:1 for Feed.`);
      }
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
        error: `Instagram media validation error: ${validation.errors.join(', ')}`,
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

    const igContent: InstagramPlatformContent =
      platformContent ||
      content.platformContent?.instagram || {
        caption: content.masterAnalysis?.contentSummary || content.title,
        hashtags: content.masterAnalysis?.keywords || [],
        cta: content.masterAnalysis?.callToAction || '',
      };

    let fullCaption = igContent.caption || '';
    if (igContent.hashtags && igContent.hashtags.length > 0) {
      const hashStr = igContent.hashtags
        .map((h) => (h.startsWith('#') ? h : `#${h}`))
        .join(' ');
      fullCaption += `\n\n${hashStr}`;
    }
    if (igContent.cta) {
      fullCaption += `\n\n${igContent.cta}`;
    }

    if (fullCaption.length > 2200) {
      fullCaption = fullCaption.substring(0, 2197) + '...';
    }

    const creds = storageService.getSocialCredentials(account.id);
    const envToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const token = creds?.encryptedAccessToken || envToken;

    if (!token || token.includes('mock') || token.length < 10) {
      return {
        success: false,
        error: 'Instagram publishing requires a valid Meta Graph API Access Token with instagram_content_publish permission.',
        requiresReauth: true,
      };
    }

    try {
      const containerRes = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(account.accountIdentifier)}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: token,
            caption: fullCaption,
            media_type: content.contentType === 'video' ? 'REELS' : 'IMAGE',
            video_url: content.mediaUrls[0],
            image_url: content.mediaUrls[0],
          }),
        }
      );

      const containerData = await containerRes.json() as any;

      if (!containerRes.ok || containerData.error) {
        const msg = containerData?.error?.message || 'Meta Graph API container creation failed';
        if (containerData?.error?.code === 190) {
          return {
            success: false,
            error: 'Instagram access token has expired. Re-authorization required.',
            requiresReauth: true,
          };
        }
        if (containerData?.error?.code === 4 || containerData?.error?.code === 17) {
          return {
            success: false,
            error: 'Instagram API rate limit reached. The system will retry automatically.',
            rateLimited: true,
            retryAfterSeconds: 1800,
          };
        }
        return {
          success: false,
          error: `Instagram API Error: ${msg}`,
        };
      }

      const containerId = containerData.id;

      const publishRes = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(account.accountIdentifier)}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: token,
            creation_id: containerId,
          }),
        }
      );

      const publishData = await publishRes.json() as any;
      if (!publishRes.ok || publishData.error) {
        return {
          success: false,
          error: `Instagram media_publish failed: ${publishData?.error?.message || 'Unknown error'}`,
        };
      }

      return {
        success: true,
        remotePostId: publishData.id || containerId,
        publishedUrl: `https://www.instagram.com/p/${publishData.id || containerId}/`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Instagram publishing network exception: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
