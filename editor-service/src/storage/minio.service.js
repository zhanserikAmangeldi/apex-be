import * as Minio from 'minio';
import { Readable } from 'stream';
import { config } from '../config/index.js';

class MinioService {
    constructor() {
        this.client = new Minio.Client({
            endPoint: config.minio.endpoint,
            port: config.minio.port,
            useSSL: config.minio.useSSL,
            accessKey: config.minio.accessKey,
            secretKey: config.minio.secretKey,
        });
    }

    /**
     * Initialize all required buckets
     */
    async initializeBuckets() {
        const buckets = Object.values(config.minio.buckets);

        for (const bucket of buckets) {
            try {
                const exists = await this.client.bucketExists(bucket);
                if (!exists) {
                    await this.client.makeBucket(bucket, 'us-east-1');
                    console.log(`Created MinIO bucket: ${bucket}`);
                } else {
                    console.log(`MinIO bucket exists: ${bucket}`);
                }
            } catch (err) {
                console.error(`Failed to initialize bucket ${bucket}:`, err);
                throw err;
            }
        }
    }

    /**
     * Upload buffer to MinIO
     */
    async upload(bucket, path, buffer, contentType = 'application/octet-stream') {
        const stream = Readable.from(buffer);
        await this.client.putObject(bucket, path, stream, buffer.length, {
            'Content-Type': contentType,
        });
    }

    /**
     * Download file from MinIO as Buffer
     */
    async download(bucket, path) {
        return new Promise((resolve, reject) => {
            const chunks = [];

            this.client.getObject(bucket, path, (err, stream) => {
                if (err) {
                    return reject(err);
                }

                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', reject);
            });
        });
    }

    /**
     * Delete object from MinIO
     */
    async delete(bucket, path) {
        await this.client.removeObject(bucket, path);
    }

    /**
     * Check if object exists
     */
    async exists(bucket, path) {
        try {
            await this.client.statObject(bucket, path);
            return true;
        } catch (err) {
            if (err.code === 'NotFound') {
                return false;
            }
            throw err;
        }
    }

    /**
     * Get object metadata
     */
    async getInfo(bucket, path) {
        return await this.client.statObject(bucket, path);
    }

    /**
     * Generate presigned URL for upload (PUT)
     */
    async generateUploadUrl(bucket, path, expirySeconds = 3600) {
        return await this.client.presignedPutObject(bucket, path, expirySeconds);
    }

    /**
     * Generate presigned URL for download (GET)
     */
    async generateDownloadUrl(bucket, path, expirySeconds = 3600) {
        return await this.client.presignedGetObject(bucket, path, expirySeconds);
    }

    /**
     * List objects in bucket with prefix
     */
    async listObjects(bucket, prefix = '', recursive = true) {
        return new Promise((resolve, reject) => {
            const objects = [];
            const stream = this.client.listObjects(bucket, prefix, recursive);

            stream.on('data', (obj) => objects.push(obj));
            stream.on('end', () => resolve(objects));
            stream.on('error', reject);
        });
    }
}

export const minioService = new MinioService();
export default minioService;
