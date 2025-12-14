import { initializeBuckets } from './minio.js';

async function main() {
    console.log('🚀 Setting up MinIO buckets...\n');

    try {
        await initializeBuckets();
        console.log('\n✅ MinIO setup completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('\n❌ MinIO setup failed:', err);
        process.exit(1);
    }
}

main();