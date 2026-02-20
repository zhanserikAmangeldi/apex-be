package mailer

import (
	"bytes"
	"fmt"
	"html/template"
	"net/smtp"
	"path/filepath"
)

type TemplateRender struct {
	templatesDir string
	templates    map[string]*template.Template
}

func NewTemplateRender(templatesDir string) *TemplateRender {
	return &TemplateRender{
		templatesDir: templatesDir,
		templates:    make(map[string]*template.Template),
	}
}

func (r *TemplateRender) LoadTemplate(name string) (*template.Template, error) {
	if tmpl, ok := r.templates[name]; ok {
		return tmpl, nil
	}

	path := filepath.Join(r.templatesDir, name+".html")
	tmpl, err := template.ParseFiles(path)
	if err != nil {
		return nil, err
	}

	r.templates[name] = tmpl
	return tmpl, nil
}

func (r *TemplateRender) Render(name string, data interface{}) (string, error) {
	tmpl, err := r.LoadTemplate(name)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}

	return buf.String(), nil
}

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
	verifyURL := fmt.Sprintf("%s/verify-email?token=%s", m.BaseURL, token)

	data := map[string]interface{}{
		"Username":  username,
		"VerifyURL": verifyURL,
	}

	body, err := m.Render.Render("verification", data)
	if err != nil {
		body = fmt.Sprintf(`
Hello %s,

Please verify your email by clicking the link below:
%s

This link will expire in 24 hours.

If you didn't create an account, please ignore this email.

Best regards,
The Apex Team
`, username, verifyURL)
	}

	return m.sendEmail(to, "Verify your email address", body)
}

func (m *SMTPMailer) SendPasswordResetEmail(to, username, token string) error {
	resetURL := fmt.Sprintf("%s/reset-password?token=%s", m.BaseURL, token)

	data := map[string]interface{}{
		"Username": username,
		"ResetURL": resetURL,
	}

	body, err := m.Render.Render("password_reset", data)
	if err != nil {
		body = fmt.Sprintf(`
Hello %s,

You requested to reset your password. Click the link below to proceed:
%s

This link will expire in 1 hour.

If you didn't request this, please ignore this email.

Best regards,
The Apex Team
`, username, resetURL)
	}

	return m.sendEmail(to, "Reset your password", body)
}

func (m *SMTPMailer) SendWelcomeEmail(to, username string) error {
	data := map[string]interface{}{
		"Username": username,
	}

	body, err := m.Render.Render("welcome", data)
	if err != nil {
		body = fmt.Sprintf(`
Hello %s,

Welcome to Apex! Your account has been successfully verified.

You can now start using all features of our platform.

Best regards,
The Apex Team
`, username)
	}

	return m.sendEmail(to, "Welcome to Apex!", body)
}

func (m *SMTPMailer) sendEmail(to, subject, body string) error {
	auth := smtp.PlainAuth("", m.User, m.Pass, m.Host)

	headers := make(map[string]string)
	headers["From"] = m.From
	headers["To"] = to
	headers["Subject"] = subject
	headers["MIME-Version"] = "1.0"
	headers["Content-Type"] = "text/html; charset=UTF-8"

	var message bytes.Buffer
	for k, v := range headers {
		message.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
	}
	message.WriteString("\r\n")
	message.WriteString(body)

	addr := fmt.Sprintf("%s:%d", m.Host, m.Port)
	return smtp.SendMail(addr, auth, m.From, []string{to}, message.Bytes())
}
