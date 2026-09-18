import { google, drive_v3, Auth } from 'googleapis';
import { Readable } from 'stream';

export type OAuth2Client = Auth.OAuth2Client;

export interface DriveFolder {
  id: string;
  name: string;
}

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  thumbnailLink?: string;
  webViewLink?: string;
  durationSeconds: number;
  width?: number;
  height?: number;
}

export class GoogleDriveService {
  public async listFolders(authClient: OAuth2Client): Promise<DriveFolder[]> {
    const drive = google.drive({ version: 'v3', auth: authClient });
    const response = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id, name)',
      pageSize: 50,
      orderBy: 'name',
    });

    const items = response.data.files || [];
    return items.map((f) => ({
      id: f.id || '',
      name: f.name || 'Untitled Folder',
    }));
  }

  public async listVideosInFolder(authClient: OAuth2Client, folderId: string): Promise<DriveFileInfo[]> {
    const drive = google.drive({ version: 'v3', auth: authClient });

    const query = `'${folderId}' in parents and trashed = false and (mimeType contains 'video/' or name contains '.mp4' or name contains '.mov' or name contains '.webm' or name contains '.avi' or name contains '.mkv')`;

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size, createdTime, thumbnailLink, webViewLink, videoMediaMetadata)',
      pageSize: 100,
      orderBy: 'createdTime desc',
    });

    const items = response.data.files || [];
    return items.map((f) => {
      const vmm = f.videoMediaMetadata;
      const durationSeconds = vmm?.durationMillis ? Math.round(Number(vmm.durationMillis) / 1000) : 0;

      return {
        id: f.id || '',
        name: f.name || 'Untitled Video',
        mimeType: f.mimeType || 'video/mp4',
        size: f.size ? Number(f.size) : 0,
        createdTime: f.createdTime || new Date().toISOString(),
        thumbnailLink: f.thumbnailLink || undefined,
        webViewLink: f.webViewLink || undefined,
        durationSeconds,
        width: vmm?.width ? Number(vmm.width) : undefined,
        height: vmm?.height ? Number(vmm.height) : undefined,
      };
    });
  }

  public async getFileStream(
    authClient: OAuth2Client,
    fileId: string
  ): Promise<{ stream: Readable; size: number; mimeType: string; name: string }> {
    const drive = google.drive({ version: 'v3', auth: authClient });

    const meta = await drive.files.get({
      fileId,
      fields: 'id, name, size, mimeType',
    });

    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const fileMeta = meta.data as { size?: string | number; mimeType?: string; name?: string };

    return {
      stream: response.data as unknown as Readable,
      size: fileMeta.size ? Number(fileMeta.size) : 0,
      mimeType: fileMeta.mimeType || 'video/mp4',
      name: fileMeta.name || 'video.mp4',
    };
  }
}

export const googleDriveService = new GoogleDriveService();
