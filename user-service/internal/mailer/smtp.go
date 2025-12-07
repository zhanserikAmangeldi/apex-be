package mailer

import (
	"fmt"
	"log"
	"net/smtp"
	"time"
)

type SMTPMailer struct {
	Host    string
	Port    int
	User    string
	Pass    string
	From    string
	BaseURL string
	Render  *TemplateRender
}

func (m *SMTPMailer) SendVerificationEmail(to, username, token string) error {
	auth := smtp.PlainAuth("", m.User, m.Pass, m.Host)
	addr := fmt.Sprintf("%s:%d", m.Host, m.Port)

	log.Println("helloworld")

	link := fmt.Sprintf("%s/verify-email?token=%s", m.BaseURL, token)

	data := map[string]any{
		"Username":  username,
		"VerifyURL": link,
		"Year":      time.Now().Year(),
	}

	htmlBody, err := m.Render.RenderTemplate("verify_email.html", data)
	if err != nil {
		return err
	}

	subject := "Verify your email address"
	msg := fmt.Sprintf("Subject: %s\n"+
		"MIME-version: 1.0;\n"+
		"Content-Type: text/html; charset=\"UTF-8\";\n%s",
		subject, htmlBody)

	log.Println("helloworld")

	return smtp.SendMail(addr, auth, m.User, []string{to}, []byte(msg))
}
