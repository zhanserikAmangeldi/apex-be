package mailer

import (
	"bytes"
	"html/template"
	"path/filepath"
)

type TemplateRender struct {
	BaseDir string
}

func NewTemplateRender(baseDir string) *TemplateRender {
	return &TemplateRender{BaseDir: baseDir}
}

func (t *TemplateRender) RenderTemplate(name string, data interface{}) (string, error) {
	path := filepath.Join(t.BaseDir, name)
	tmpl, err := template.ParseFiles(path)
	if err != nil {
		return "", err
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}

	return buf.String(), nil
}
