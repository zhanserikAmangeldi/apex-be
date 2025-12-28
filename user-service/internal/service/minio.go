package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/config"
)

const (
	AvatarsBucket = "avatars"
)

type MinioService struct {
	client *minio.Client
}

func NewMinioService(cfg *config.Config) *MinioService {
	endpoint := fmt.Sprintf("%s:%s", cfg.MinioHost, cfg.MinioPort)

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioUser, cfg.MinioPass, ""),
		Secure: cfg.MinioUseSSL,
	})
	if err != nil {
		log.Fatalf("Failed to create MinIO client: %v", err)
	}

	log.Printf("MinIO client initialized: %s", endpoint)

	// Initialize buckets
	ctx := context.Background()
	if err := initializeBucket(ctx, client, AvatarsBucket); err != nil {
		log.Fatalf("Failed to initialize bucket %s: %v", AvatarsBucket, err)
	}

	return &MinioService{client: client}
}

func initializeBucket(ctx context.Context, client *minio.Client, bucketName string) error {
	exists, err := client.BucketExists(ctx, bucketName)
	if err != nil {
		return fmt.Errorf("failed to check bucket existence: %w", err)
	}

	if !exists {
		if err := client.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("failed to create bucket: %w", err)
		}
		log.Printf("Created MinIO bucket: %s", bucketName)
	} else {
		log.Printf("MinIO bucket exists: %s", bucketName)
	}

	return nil
}

func (s *MinioService) UploadFile(ctx context.Context, bucket, objectName string, reader io.Reader, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, bucket, objectName, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

func (s *MinioService) GetFile(ctx context.Context, bucket, objectName string) (*minio.Object, error) {
	return s.client.GetObject(ctx, bucket, objectName, minio.GetObjectOptions{})
}

func (s *MinioService) GetFileInfo(ctx context.Context, bucket, objectName string) (minio.ObjectInfo, error) {
	return s.client.StatObject(ctx, bucket, objectName, minio.StatObjectOptions{})
}

func (s *MinioService) DeleteFile(ctx context.Context, bucket, objectName string) error {
	return s.client.RemoveObject(ctx, bucket, objectName, minio.RemoveObjectOptions{})
}

func (s *MinioService) GeneratePresignedURL(ctx context.Context, bucket, objectName string, expiry time.Duration) (*url.URL, error) {
	return s.client.PresignedGetObject(ctx, bucket, objectName, expiry, nil)
}

func (s *MinioService) GeneratePresignedUploadURL(ctx context.Context, bucket, objectName string, expiry time.Duration) (*url.URL, error) {
	return s.client.PresignedPutObject(ctx, bucket, objectName, expiry)
}

func (s *MinioService) FileExists(ctx context.Context, bucket, objectName string) (bool, error) {
	_, err := s.client.StatObject(ctx, bucket, objectName, minio.StatObjectOptions{})
	if err != nil {
		errResponse := minio.ToErrorResponse(err)
		if errResponse.Code == "NoSuchKey" {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Client returns the underlying MinIO client for advanced operations
func (s *MinioService) Client() *minio.Client {
	return s.client
}
