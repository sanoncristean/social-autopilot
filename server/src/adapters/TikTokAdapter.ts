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
  TikTokPlatformContent,
} from '../types/index.js';
import { storageService } from '../services/StorageService.js';

export class TikTokAdapter implements SocialPlatformAdapter {
  readonly platform: SocialPlatform = 'tiktok';

  getCapabilities(): PlatformCapabilities {
    return {
      platform: 'tiktok',
      displayName: 'TikTok',
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
      maxFileSizeMB: 1024,
      supportedFormats: ['video/mp4', 'video/webm', 'image/jpeg', 'image/png'],
      aspectRatios: ['9:16', '1:1'],
      maxCaptionLength: 2200,
      requiresSpecialPermissions: true,
      notes: 'Requires TikTok Developer Account with video.publish and video.upload approved scopes.',
    };
  }

  async validateConnection(account: SocialAccount): Promise<ConnectionValidationResult> {
    const creds = storageService.getSocialCredentials(account.id);
    if (!creds || !creds.encryptedAccessToken) {
      return {
        valid: false,
        error: 'TikTok account requires connection. Please complete TikTok OAuth verification.',
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
      errors.push('No media attached for TikTok upload.');
    }

    if (content.aspectRatio && content.aspectRatio !== '9:16') {
      warnings.push('TikTok standard format is vertical 9:16. Horizontal videos will show letterbox bars.');
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
        error: `TikTok validation error: ${validation.errors.join(', ')}`,
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

    const ttContent: TikTokPlatformContent =
      platformContent ||
      content.platformContent?.tiktok || {
        caption: content.masterAnalysis?.contentSummary || content.title,
        hashtags: content.masterAnalysis?.keywords || [],
        cta: content.masterAnalysis?.callToAction || '',
      };

    let fullCaption = ttContent.caption || '';
    if (ttContent.hashtags && ttContent.hashtags.length > 0) {
      const hashStr = ttContent.hashtags
        .map((h) => (h.startsWith('#') ? h : `#${h}`))
        .join(' ');
      fullCaption += `\n\n${hashStr}`;
    }

    const creds = storageService.getSocialCredentials(account.id);
    const envToken = process.env.TIKTOK_ACCESS_TOKEN;
    const token = creds?.encryptedAccessToken || envToken;

    if (!token || token.includes('mock') || token.length < 10) {
      return {
        success: false,
        error: 'TikTok publishing requires approved video.publish and video.upload OAuth tokens from the TikTok Developer Portal.',
        requiresReauth: true,
      };
    }

    try {
      const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post_info: {
            title: fullCaption,
            privacy_level: ttContent.privacyLevel || 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_stitch: false,
            disable_comment: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: content.mediaUrls[0],
          },
        }),
      });

      const data = (await res.json()) as any;

      if (!res.ok || data.error?.code !== 'ok') {
        const errorMsg = data?.error?.message || 'TikTok API submission error';
        return {
          success: false,
          error: `TikTok API error: ${errorMsg}`,
        };
      }

      const publishId = data.data?.publish_id;
      return {
        success: true,
        remotePostId: publishId,
        publishedUrl: `https://www.tiktok.com/@${encodeURIComponent(account.accountIdentifier)}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `TikTok request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
