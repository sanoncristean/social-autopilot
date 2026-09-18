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
  FacebookPlatformContent,
} from '../types/index.js';
import { storageService } from '../services/StorageService.js';

export class FacebookAdapter implements SocialPlatformAdapter {
  readonly platform: SocialPlatform = 'facebook';

  getCapabilities(): PlatformCapabilities {
    return {
      platform: 'facebook',
      displayName: 'Facebook',
      supportsVideo: true,
      supportsImages: true,
      supportsMultipleImages: true,
      supportsScheduling: true,
      supportsDirectPublishing: true,
      supportsCaptions: true,
      supportsHashtags: true,
      supportsTitle: true,
      supportsDescription: true,
      supportsTags: true,
      supportsCarousel: true,
      maxFileSizeMB: 10000,
      supportedFormats: ['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:5'],
      maxCaptionLength: 63206,
      requiresSpecialPermissions: true,
      notes: 'Publishes to Facebook Pages using the Graph API pages_manage_posts scope.',
    };
  }

  async validateConnection(account: SocialAccount): Promise<ConnectionValidationResult> {
    const creds = storageService.getSocialCredentials(account.id);
    if (!creds || !creds.encryptedAccessToken) {
      return {
        valid: false,
        error: 'Facebook account authorization required. Please reconnect via Facebook OAuth.',
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
      errors.push('No media attached for Facebook publishing.');
    }

    if (content.contentType === 'image_set' && content.mediaUrls.length > 5) {
      errors.push('Facebook batch publishing currently configured for up to 5 images.');
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
        error: `Facebook media validation failed: ${validation.errors.join(', ')}`,
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

    const fbContent: FacebookPlatformContent =
      platformContent ||
      content.platformContent?.facebook || {
        postText: content.masterAnalysis?.contentSummary || content.title,
        hashtags: content.masterAnalysis?.keywords || [],
        cta: content.masterAnalysis?.callToAction || '',
      };

    let fullMessage = fbContent.postText || '';
    if (fbContent.hashtags && fbContent.hashtags.length > 0) {
      const hashStr = fbContent.hashtags
        .map((h) => (h.startsWith('#') ? h : `#${h}`))
        .join(' ');
      fullMessage += `\n\n${hashStr}`;
    }
    if (fbContent.cta) {
      fullMessage += `\n\n${fbContent.cta}`;
    }

    const creds = storageService.getSocialCredentials(account.id);
    const envToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const token = creds?.encryptedAccessToken || envToken;

    if (!token || token.includes('mock') || token.length < 10) {
      return {
        success: false,
        error: 'Facebook Page publishing requires a Page Access Token with pages_manage_posts and pages_read_engagement permissions.',
        requiresReauth: true,
      };
    }

    try {
      const pageId = account.accountIdentifier;
      const endpoint =
        content.contentType === 'video'
          ? `https://graph-video.facebook.com/v19.0/${encodeURIComponent(pageId)}/videos`
          : `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/photos`;

      const bodyPayload =
        content.contentType === 'video'
          ? {
              access_token: token,
              description: fullMessage,
              title: content.title,
              file_url: content.mediaUrls[0],
            }
          : {
              access_token: token,
              caption: fullMessage,
              url: content.mediaUrls[0],
            };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      const data = (await res.json()) as any;

      if (!res.ok || data.error) {
        const errorMsg = data?.error?.message || 'Facebook Graph API failed';
        if (data?.error?.code === 190) {
          return {
            success: false,
            error: 'Facebook Page Token expired. Please re-authorize Facebook.',
            requiresReauth: true,
          };
        }
        return {
          success: false,
          error: `Facebook API error: ${errorMsg}`,
        };
      }

      const postId = data.id || data.post_id;
      return {
        success: true,
        remotePostId: postId,
        publishedUrl: `https://www.facebook.com/${postId}`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Facebook request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
