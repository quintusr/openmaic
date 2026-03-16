// ABOUTME: OpenMAIC-specific S3 storage operations
// Manages subjects manifest, subject indices, and lesson classroom data
// Uses AWS default credential chain (SSO, env vars, IAM roles)
// Falls back to local filesystem when S3 is not reachable

import { promises as fs } from 'fs';
import path from 'path';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  createS3Client,
  checkS3Available,
  s3Key,
  uploadJson,
  downloadJson,
  uploadBlob,
  downloadBlob,
  listKeys,
} from './client';
import type {
  SubjectsManifest,
  SubjectIndex,
} from '@/lib/course-spec/types';
import type { PersistedClassroomData } from '@/lib/server/classroom-storage';

const LOCAL_DIR = path.join(process.cwd(), 'data', 'browse');

async function ensureLocalDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function localPath(...segments: string[]): string {
  return path.join(LOCAL_DIR, ...segments);
}

async function readLocalJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeLocalJson(filePath: string, data: unknown): Promise<void> {
  await ensureLocalDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Storage facade: S3 with local fallback
// ---------------------------------------------------------------------------

export class BrowseStorage {
  private s3: S3Client | null = null;
  private s3Checked = false;

  /**
   * Lazily initialize the S3 client on first use.
   * Uses the AWS default credential chain (SSO, env vars, IAM roles).
   */
  private async ensureS3(): Promise<S3Client | null> {
    if (this.s3Checked) return this.s3;
    this.s3Checked = true;

    const available = await checkS3Available();
    if (available) {
      this.s3 = createS3Client(process.env.AWS_REGION || 'eu-west-1');
      console.log('[BrowseStorage] S3 connected (hello-content-factory/openmaic/)');
    } else {
      console.log('[BrowseStorage] S3 not available, using local storage only');
    }
    return this.s3;
  }

  get hasS3(): boolean {
    return this.s3 !== null;
  }

  // -- Subjects manifest --------------------------------------------------

  async getSubjectsManifest(): Promise<SubjectsManifest | null> {
    const s3 = await this.ensureS3();
    if (s3) {
      const data = await downloadJson<SubjectsManifest>(
        s3,
        s3Key('subjects.json'),
      );
      if (data) return data;
    }
    return readLocalJson<SubjectsManifest>(localPath('subjects.json'));
  }

  async saveSubjectsManifest(manifest: SubjectsManifest): Promise<void> {
    await writeLocalJson(localPath('subjects.json'), manifest);
    const s3 = await this.ensureS3();
    if (s3) {
      await uploadJson(s3, s3Key('subjects.json'), manifest);
    }
  }

  // -- Subject index ------------------------------------------------------

  async getSubjectIndex(
    subjectCode: string,
  ): Promise<SubjectIndex | null> {
    const s3 = await this.ensureS3();
    if (s3) {
      const data = await downloadJson<SubjectIndex>(
        s3,
        s3Key(subjectCode, 'index.json'),
      );
      if (data) return data;
    }
    return readLocalJson<SubjectIndex>(
      localPath(subjectCode, 'index.json'),
    );
  }

  async saveSubjectIndex(index: SubjectIndex): Promise<void> {
    const code = index.subjectCode;
    await writeLocalJson(localPath(code, 'index.json'), index);
    const s3 = await this.ensureS3();
    if (s3) {
      await uploadJson(s3, s3Key(code, 'index.json'), index);
    }
  }

  // -- Lesson classroom data ----------------------------------------------

  async getLesson(
    subjectCode: string,
    courseId: string,
    lessonId: string,
  ): Promise<PersistedClassroomData | null> {
    const s3 = await this.ensureS3();
    if (s3) {
      const data = await downloadJson<PersistedClassroomData>(
        s3,
        s3Key(subjectCode, courseId, `${lessonId}.json`),
      );
      if (data) return data;
    }
    return readLocalJson<PersistedClassroomData>(
      localPath(subjectCode, courseId, `${lessonId}.json`),
    );
  }

  async saveLesson(
    subjectCode: string,
    courseId: string,
    lessonId: string,
    data: PersistedClassroomData,
  ): Promise<void> {
    await writeLocalJson(
      localPath(subjectCode, courseId, `${lessonId}.json`),
      data,
    );
    const s3 = await this.ensureS3();
    if (s3) {
      await uploadJson(
        s3,
        s3Key(subjectCode, courseId, `${lessonId}.json`),
        data,
      );
    }
  }

  // -- Audio files (TTS) ---------------------------------------------------

  async saveAudio(
    subjectCode: string,
    courseId: string,
    lessonId: string,
    audioId: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    // Save locally
    const dir = localPath(subjectCode, courseId, lessonId, 'audio');
    await ensureLocalDir(dir);
    await fs.writeFile(path.join(dir, audioId), Buffer.from(bytes));

    const s3 = await this.ensureS3();
    if (s3) {
      await uploadBlob(
        s3,
        s3Key(subjectCode, courseId, lessonId, 'audio', audioId),
        bytes,
        contentType,
      );
    }
  }

  async getAudio(
    subjectCode: string,
    courseId: string,
    lessonId: string,
    audioId: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    // Try local first
    const filePath = localPath(subjectCode, courseId, lessonId, 'audio', audioId);
    try {
      const buf = await fs.readFile(filePath);
      return { bytes: new Uint8Array(buf), contentType: 'audio/mpeg' };
    } catch {
      // fall through to S3
    }

    const s3 = await this.ensureS3();
    if (s3) {
      return downloadBlob(
        s3,
        s3Key(subjectCode, courseId, lessonId, 'audio', audioId),
      );
    }
    return null;
  }

  // -- Media files (images) -----------------------------------------------

  async saveMedia(
    subjectCode: string,
    courseId: string,
    lessonId: string,
    mediaId: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const dir = localPath(subjectCode, courseId, lessonId, 'media');
    await ensureLocalDir(dir);
    await fs.writeFile(path.join(dir, mediaId), Buffer.from(bytes));

    const s3 = await this.ensureS3();
    if (s3) {
      await uploadBlob(
        s3,
        s3Key(subjectCode, courseId, lessonId, 'media', mediaId),
        bytes,
        contentType,
      );
    }
  }

  async getMedia(
    subjectCode: string,
    courseId: string,
    lessonId: string,
    mediaId: string,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const filePath = localPath(subjectCode, courseId, lessonId, 'media', mediaId);
    try {
      const buf = await fs.readFile(filePath);
      const ext = mediaId.split('.').pop() || 'png';
      return { bytes: new Uint8Array(buf), contentType: `image/${ext}` };
    } catch {
      // fall through to S3
    }

    const s3 = await this.ensureS3();
    if (s3) {
      return downloadBlob(
        s3,
        s3Key(subjectCode, courseId, lessonId, 'media', mediaId),
      );
    }
    return null;
  }

  // -- List available subjects from S3 ------------------------------------

  async listSubjectCodes(): Promise<string[]> {
    const s3 = await this.ensureS3();
    if (s3) {
      const keys = await listKeys(s3, s3Key(''));
      const codes = new Set<string>();
      for (const key of keys) {
        // openmaic/AI/index.json -> AI
        const parts = key.replace('openmaic/', '').split('/');
        if (parts.length >= 2 && parts[1] === 'index.json') {
          codes.add(parts[0]);
        }
      }
      return [...codes].sort();
    }

    // Fall back to local directory listing
    try {
      const entries = await fs.readdir(LOCAL_DIR, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }
}

/** Singleton storage instance */
let _storage: BrowseStorage | null = null;

export function getBrowseStorage(): BrowseStorage {
  if (!_storage) {
    _storage = new BrowseStorage();
  }
  return _storage;
}
