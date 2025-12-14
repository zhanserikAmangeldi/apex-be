import * as Minio from 'minio';
import dotenv from 'dotenv';
import { Readable } from 'stream';

dotenv.config();

export const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
});

/**
 * Initialize MinIO buckets
 */
export async function initializeBuckets() {
    const buckets = [
        process.env.MINIO_BUCKET_SNAPSHOTS,
        process.env.MINIO_BUCKET_ATTACHMENTS,
    ];

    for (const bucket of buckets) {
        try {
            const exists = await minioClient.bucketExists(bucket);
            if (!exists) {
                await minioClient.makeBucket(bucket, 'us-east-1');
                console.log(`✓ Created MinIO bucket: ${bucket}`);
            } else {
                console.log(`✓ MinIO bucket exists: ${bucket}`);
            }
        } catch (err) {
            console.error(`Failed to create bucket ${bucket}:`, err);
            throw err;
        }
    }
}

/**
 * Upload buffer to MinIO
 */
export async function uploadToMinio(bucket, path, buffer) {
    const stream = Readable.from(buffer);

    await minioClient.putObject(
        bucket,
        path,
        stream,
        buffer.length,
        {
            'Content-Type': 'application/octet-stream',
        }
    );
}

/**
 * Download file from MinIO as Buffer
 */
export async function downloadFromMinio(bucket, path) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        minioClient.getObject(bucket, path, (err, stream) => {
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
 * Generate presigned URL for upload (PUT)
 */
export async function generatePresignedUploadUrl(bucket, path, expirySeconds = 3600) {
    return await minioClient.presignedPutObject(bucket, path, expirySeconds);
}

/**
 * Generate presigned URL for download (GET)
 */
export async function generatePresignedDownloadUrl(bucket, path, expirySeconds = 3600) {
    return await minioClient.presignedGetObject(bucket, path, expirySeconds);
}

/**
 * Delete object from MinIO
 */
export async function deleteFromMinio(bucket, path) {
    await minioClient.removeObject(bucket, path);
}

/**
 * Check if object exists
 */
export async function objectExists(bucket, path) {
    try {
        await minioClient.statObject(bucket, path);
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
export async function getObjectInfo(bucket, path) {
    return await minioClient.statObject(bucket, path);
}

export default minioClient;