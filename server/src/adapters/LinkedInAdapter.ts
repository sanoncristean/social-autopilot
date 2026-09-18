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
  LinkedInPlatformContent,
} from '../types/index.js';
import { storageService } from '../services/StorageService.js';

export class LinkedInAdapter implements SocialPlatformAdapter {
  readonly platform: SocialPlatform = 'linkedin';

  getCapabilities(): PlatformCapabilities {
    return {
      platform: 'linkedin',
      displayName: 'LinkedIn',
      supportsVideo: true,
      supportsImages: true,
      supportsMultipleImages: true,
      supportsScheduling: true,
      supportsDirectPublishing: true,
      supportsCaptions: true,
      supportsHashtags: true,
      supportsTitle: true,
      supportsDescription: true,
      supportsTags: false,
      supportsCarousel: true,
      maxFileSizeMB: 500,
      supportedFormats: ['video/mp4', 'image/jpeg', 'image/png', 'image/gif'],
      aspectRatios: ['16:9', '1:1', '4:5'],
      maxCaptionLength: 3000,
      requiresSpecialPermissions: false,
      notes: 'Publishes to personal profiles or company pages via LinkedIn REST Posts API with w_member_social scope.',
    };
  }

  async validateConnection(account: SocialAccount): Promise<ConnectionValidationResult> {
    const creds = storageService.getSocialCredentials(account.id);
    if (!creds || !creds.encryptedAccessToken) {
      return {
        valid: false,
        error: 'LinkedIn account authorization missing. Reconnect via LinkedIn OAuth.',
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
      errors.push('No media attached for LinkedIn post.');
    }

    if (content.contentType === 'image_set' && content.mediaUrls.length > 9) {
      warnings.push('LinkedIn supports up to 9 images per multi-image post.');
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
        error: `LinkedIn validation failed: ${validation.errors.join(', ')}`,
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

    const liContent: LinkedInPlatformContent =
      platformContent ||
      content.platformContent?.linkedin || {
        postText: content.masterAnalysis?.contentSummary || content.title,
        hashtags: content.masterAnalysis?.keywords || [],
        cta: content.masterAnalysis?.callToAction || '',
      };

    let fullCommentary = liContent.postText || '';
    if (liContent.hashtags && liContent.hashtags.length > 0) {
      const hashStr = liContent.hashtags
        .map((h) => (h.startsWith('#') ? h : `#${h}`))
        .join(' ');
      fullCommentary += `\n\n${hashStr}`;
    }
    if (liContent.cta) {
      fullCommentary += `\n\n${liContent.cta}`;
    }

    const creds = storageService.getSocialCredentials(account.id);
    const envToken = process.env.LINKEDIN_ACCESS_TOKEN;
    const token = creds?.encryptedAccessToken || envToken;

    if (!token || token.includes('mock') || token.length < 10) {
      return {
        success: false,
        error: 'LinkedIn publishing requires a valid Access Token with w_member_social or w_organization_social permission.',
        requiresReauth: true,
      };
    }

    try {
      const authorUrn = account.accountIdentifier.startsWith('urn:li:')
        ? account.accountIdentifier
        : `urn:li:person:${account.accountIdentifier}`;

      const res = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202401',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author: authorUrn,
          commentary: fullCommentary,
          visibility: liContent.visibility || 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        if (res.status === 401) {
          return {
            success: false,
            error: 'LinkedIn access token expired. Please re-authenticate.',
            requiresReauth: true,
          };
        }
        return {
          success: false,
          error: `LinkedIn API error (${res.status}): ${errorText}`,
        };
      }

      const postId = res.headers.get('x-restli-id') || `li_${Date.now()}`;
      return {
        success: true,
        remotePostId: postId,
        publishedUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}/`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        error: `LinkedIn request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
