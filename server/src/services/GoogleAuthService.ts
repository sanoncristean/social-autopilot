import { google, Auth } from 'googleapis';
import { storageService } from './StorageService.js';
import { GoogleConnection } from '../types/index.js';

export type OAuth2Client = Auth.OAuth2Client;

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export class GoogleAuthService {
  private getRedirectUri(): string {
    if (process.env.GOOGLE_REDIRECT_URI) {
      return process.env.GOOGLE_REDIRECT_URI;
    }
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    return `${appUrl.replace(/\/$/, '')}/api/auth/google/callback`;
  }

  public getOAuth2Client(): OAuth2Client {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = this.getRedirectUri();

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  public isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  public generateAuthUrl(userId: string): { url: string; error?: string } {
    if (!this.isConfigured()) {
      return {
        url: '',
        error:
          'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
      };
    }

    const oauth2Client = this.getOAuth2Client();
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state: userId,
      include_granted_scopes: true,
    });

    return { url };
  }

  public async handleCallback(
    code: string,
    userId: string
  ): Promise<{ success: boolean; email?: string; error?: string }> {
    try {
      const oauth2Client = this.getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();

      const email = userInfo.data.email || 'user@example.com';
      const name = userInfo.data.name || 'Google User';
      const avatarUrl = userInfo.data.picture || undefined;

      const existingUser = await storageService.getUser(userId);
      const role = existingUser?.role || (email.toLowerCase() === 'sarveshtiwarisarvesh@gmail.com' ? 'admin' : 'user');
      await storageService.saveUser({
        userId,
        email,
        name,
        role,
        avatarUrl,
        createdAt: existingUser?.createdAt || new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      });

      const connection: GoogleConnection = {
        userId,
        email,
        connected: true,
        scopes: SCOPES,
        accessToken: tokens.access_token || undefined,
        refreshToken: tokens.refresh_token || undefined,
        expiryDate: tokens.expiry_date || undefined,
        tokenType: tokens.token_type || 'Bearer',
        connectedAt: new Date().toISOString(),
      };
      await storageService.saveGoogleConnection(connection);

      try {
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        const channelRes = await youtube.channels.list({
          part: ['snippet', 'statistics'],
          mine: true,
        });
        const ch = channelRes.data.items?.[0];
        if (ch) {
          await storageService.saveYouTubeChannel({
            userId,
            channelId: ch.id || '',
            channelTitle: ch.snippet?.title || 'My YouTube Channel',
            customUrl: ch.snippet?.customUrl || undefined,
            thumbnailUrl: ch.snippet?.thumbnails?.default?.url || undefined,
            subscriberCount: ch.statistics?.subscriberCount ? Number(ch.statistics.subscriberCount) : undefined,
            videoCount: ch.statistics?.videoCount ? Number(ch.statistics.videoCount) : undefined,
            connectedAt: new Date().toISOString(),
          });
        }
      } catch (ytErr) {
        console.warn('Could not fetch YouTube channel details immediately:', ytErr);
      }

      return { success: true, email };
    } catch (err: unknown) {
      console.error('OAuth Callback Error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to exchange authorization code.',
      };
    }
  }

  public async getAuthenticatedClient(userId: string): Promise<OAuth2Client | null> {
    const connection = await storageService.getGoogleConnection(userId);
    if (!connection || !connection.connected || !connection.refreshToken) {
      return null;
    }

    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken,
      expiry_date: connection.expiryDate,
    });

    oauth2Client.on('tokens', async (newTokens) => {
      const updated: GoogleConnection = {
        ...connection,
        accessToken: newTokens.access_token || connection.accessToken,
        expiryDate: newTokens.expiry_date || connection.expiryDate,
      };
      if (newTokens.refresh_token) {
        updated.refreshToken = newTokens.refresh_token;
      }
      await storageService.saveGoogleConnection(updated);
    });

    return oauth2Client;
  }

  public async disconnect(userId: string): Promise<void> {
    const client = await this.getAuthenticatedClient(userId);
    if (client) {
      try {
        const creds = client.credentials;
        if (creds.access_token) {
          await client.revokeToken(creds.access_token);
        }
      } catch (err) {
        console.warn('Revoke token warning:', err);
      }
    }
    await storageService.deleteGoogleConnection(userId);
  }
}

export const googleAuthService = new GoogleAuthService();
