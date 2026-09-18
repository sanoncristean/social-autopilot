import { SocialPlatform, PlatformCapabilities, SocialAccount, ContentItem } from '../types/index.js';
import {
  SocialPlatformAdapter,
  PublishResult,
  MediaValidationResult,
  ConnectionValidationResult,
} from './SocialPlatformAdapter.js';
import { YouTubeAdapter } from './YouTubeAdapter.js';
import { InstagramAdapter } from './InstagramAdapter.js';
import { FacebookAdapter } from './FacebookAdapter.js';
import { XAdapter } from './XAdapter.js';
import { TikTokAdapter } from './TikTokAdapter.js';
import { LinkedInAdapter } from './LinkedInAdapter.js';

class SocialAdapterRegistry {
  private adapters: Map<SocialPlatform, SocialPlatformAdapter> = new Map();

  constructor() {
    this.register(new YouTubeAdapter());
    this.register(new InstagramAdapter());
    this.register(new FacebookAdapter());
    this.register(new XAdapter());
    this.register(new TikTokAdapter());
    this.register(new LinkedInAdapter());
  }

  register(adapter: SocialPlatformAdapter) {
    this.adapters.set(adapter.platform, adapter);
  }

  getAdapter(platform: SocialPlatform): SocialPlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`Unsupported social platform adapter: ${platform}`);
    }
    return adapter;
  }

  hasAdapter(platform: string): boolean {
    return this.adapters.has(platform as SocialPlatform);
  }

  getAllAdapters(): SocialPlatformAdapter[] {
    return Array.from(this.adapters.values());
  }

  getAllCapabilities(): PlatformCapabilities[] {
    return this.getAllAdapters().map((adapter) => adapter.getCapabilities());
  }

  getPlatformCapabilities(platform: SocialPlatform): PlatformCapabilities {
    return this.getAdapter(platform).getCapabilities();
  }

  async validateConnection(
    account: SocialAccount,
    credentials?: any
  ): Promise<ConnectionValidationResult> {
    const adapter = this.getAdapter(account.platform);
    return adapter.validateConnection(account, credentials);
  }

  async validateMediaForPlatform(
    platform: SocialPlatform,
    content: ContentItem
  ): Promise<MediaValidationResult> {
    const adapter = this.getAdapter(platform);
    return adapter.validateMedia(content);
  }

  async publish(params: {
    account: SocialAccount;
    content: ContentItem;
    platformContent?: any;
    accessToken?: string;
  }): Promise<PublishResult> {
    const adapter = this.getAdapter(params.account.platform);
    return adapter.publish(params);
  }
}

export const socialAdapterRegistry = new SocialAdapterRegistry();
