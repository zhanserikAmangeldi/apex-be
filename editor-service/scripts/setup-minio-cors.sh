#!/bin/bash

echo "Setting up MinIO CORS configuration..."

echo "Waiting for MinIO to be ready..."
sleep 5

docker exec minio mc alias set myminio http://localhost:9000 admin change-me-in-production-min-8-chars

echo "Setting CORS for attachments bucket..."
docker exec minio mc anonymous set-json /dev/stdin myminio/attachments <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": ["*"]},
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": ["arn:aws:s3:::attachments/*"]
    }
  ]
}
EOF

echo "Setting CORS rules..."
docker exec minio mc admin config set myminio api cors_allow_origin="http://localhost:5173,http://localhost:3000,http://localhost:8000"

echo "Restarting MinIO..."
docker restart minio

echo "MinIO CORS configuration complete!"
echo "You may need to wait a few seconds for MinIO to restart."
