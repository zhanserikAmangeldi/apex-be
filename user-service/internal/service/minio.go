package service

import (
	"context"
	"log"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/zhanserikAmangeldi/apex-be/user-service/internal/config"
)

type Minio struct {
	MinioClient *minio.Client
}

func NewMinioService(cfg *config.Config) *Minio {
	var err error
	minioClient, err := minio.New(cfg.MinioHost+":"+cfg.MinioApiPort, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioUser, cfg.MinioPass, ""),
		Secure: false,
	})
	if err != nil {
		log.Fatal(err)
	}

	log.Printf("minio client is ready: %#v\n", minioClient)

	ctx := context.Background()
	bucketName := "avatars"

	exists, err := minioClient.BucketExists(ctx, bucketName)
	if err != nil {
		log.Fatal(err)
	}
	if !exists {
		err := minioClient.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{})
		if err != nil {
			log.Fatal(err)
		}

		log.Printf("minio bucket %s created", bucketName)
	}

	return &Minio{
		MinioClient: minioClient,
	}
}
