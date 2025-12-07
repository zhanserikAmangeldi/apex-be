package email

import (
	"crypto/tls"
	"fmt"
	"net/smtp"
)

type EmailService struct {
	smtpHost     string
	smtpPort     string
	smtpUsername string
	smtpPassword string
	fromEmail    string
}

func NewEmailService(smtpHost, smtpPort, smtpUsername, smtpPassword, fromEmail string) *EmailService {
	return &EmailService{
		smtpHost:     smtpHost,
		smtpPort:     smtpPort,
		smtpUsername: smtpUsername,
		smtpPassword: smtpPassword,
		fromEmail:    fromEmail,
	}
}

func (e *EmailService) SendResetCode(toEmail, code string) error {
	to := []string{toEmail}
	subject := "Password Reset Code"
	body := fmt.Sprintf(`
Hello,

You have requested to reset your password. Please use the following code to complete the reset:

%s

This code will expire in 15 minutes.

If you did not request this password reset, please ignore this email.

Best regards,
Apex Team
`, code)

	message := []byte(fmt.Sprintf("Subject: %s\r\n\r\n%s", subject, body))

	addr := fmt.Sprintf("%s:%s", e.smtpHost, e.smtpPort)
	auth := smtp.PlainAuth("", e.smtpUsername, e.smtpPassword, e.smtpHost)

	client, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("failed to connect to SMTP server: %w", err)
	}
	defer client.Close()

	if ok, _ := client.Extension("STARTTLS"); ok {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: false,
			ServerName:         e.smtpHost,
		}
		if err = client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("failed to start TLS: %w", err)
		}
	}

	if err = client.Auth(auth); err != nil {
		return fmt.Errorf("failed to authenticate: %w", err)
	}

	if err = client.Mail(e.fromEmail); err != nil {
		return fmt.Errorf("failed to set sender: %w", err)
	}

	if err = client.Rcpt(to[0]); err != nil {
		return fmt.Errorf("failed to set recipient: %w", err)
	}

	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("failed to get data writer: %w", err)
	}

	if _, err = writer.Write(message); err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	if err = writer.Close(); err != nil {
		return fmt.Errorf("failed to close writer: %w", err)
	}

	return client.Quit()
}

