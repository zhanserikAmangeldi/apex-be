FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o user-service ./cmd/api/main.go

FROM alpine:3.19

WORKDIR /app
COPY --from=builder /app/user-service .
COPY --from=builder /app/internal/migration/migrations ./internal/migration/migrations
COPY --from=builder /app/internal/mailer/templates ./internal/mailer/templates

EXPOSE 8080

CMD ["./user-service"]
