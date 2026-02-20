package validator

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

type ValidationErrors []ValidationError

func (e ValidationErrors) Error() string {
	var msgs []string
	for _, err := range e {
		msgs = append(msgs, err.Error())
	}
	return strings.Join(msgs, "; ")
}

func (e ValidationErrors) HasErrors() bool {
	return len(e) > 0
}

type Validator struct {
	errors ValidationErrors
}

func New() *Validator {
	return &Validator{
		errors: make(ValidationErrors, 0),
	}
}

func (v *Validator) AddError(field, message string) {
	v.errors = append(v.errors, ValidationError{
		Field:   field,
		Message: message,
	})
}

func (v *Validator) HasErrors() bool {
	return len(v.errors) > 0
}

func (v *Validator) Errors() ValidationErrors {
	return v.errors
}

func (v *Validator) Required(field, value string) *Validator {
	if strings.TrimSpace(value) == "" {
		v.AddError(field, "is required")
	}
	return v
}

func (v *Validator) MinLength(field, value string, min int) *Validator {
	if len(value) < min {
		v.AddError(field, fmt.Sprintf("must be at least %d characters", min))
	}
	return v
}

func (v *Validator) MaxLength(field, value string, max int) *Validator {
	if len(value) > max {
		v.AddError(field, fmt.Sprintf("must be at most %d characters", max))
	}
	return v
}

func (v *Validator) Length(field, value string, min, max int) *Validator {
	return v.MinLength(field, value, min).MaxLength(field, value, max)
}

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

func (v *Validator) Email(field, value string) *Validator {
	if value != "" && !emailRegex.MatchString(value) {
		v.AddError(field, "must be a valid email address")
	}
	return v
}

var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func (v *Validator) Username(field, value string) *Validator {
	if value != "" && !usernameRegex.MatchString(value) {
		v.AddError(field, "can only contain letters, numbers, underscores, and hyphens")
	}
	return v
}

func (v *Validator) Password(field, value string) *Validator {
	if len(value) < 8 {
		v.AddError(field, "must be at least 8 characters")
		return v
	}

	var hasUpper, hasLower, hasDigit bool
	for _, c := range value {
		switch {
		case unicode.IsUpper(c):
			hasUpper = true
		case unicode.IsLower(c):
			hasLower = true
		case unicode.IsDigit(c):
			hasDigit = true
		}
	}

	if !hasUpper {
		v.AddError(field, "must contain at least one uppercase letter")
	}
	if !hasLower {
		v.AddError(field, "must contain at least one lowercase letter")
	}
	if !hasDigit {
		v.AddError(field, "must contain at least one digit")
	}

	return v
}

var uuidRegex = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (v *Validator) UUID(field, value string) *Validator {
	if value != "" && !uuidRegex.MatchString(value) {
		v.AddError(field, "must be a valid UUID")
	}
	return v
}

var urlRegex = regexp.MustCompile(`^https?://[^\s/$.?#].[^\s]*$`)

func (v *Validator) URL(field, value string) *Validator {
	if value != "" && !urlRegex.MatchString(value) {
		v.AddError(field, "must be a valid URL")
	}
	return v
}

var hexColorRegex = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func (v *Validator) HexColor(field, value string) *Validator {
	if value != "" && !hexColorRegex.MatchString(value) {
		v.AddError(field, "must be a valid hex color (e.g., #FF5733)")
	}
	return v
}

func (v *Validator) OneOf(field, value string, allowed []string) *Validator {
	for _, a := range allowed {
		if value == a {
			return v
		}
	}
	v.AddError(field, fmt.Sprintf("must be one of: %s", strings.Join(allowed, ", ")))
	return v
}

func ValidateRegisterRequest(username, email, password, displayName string) ValidationErrors {
	v := New()

	v.Required("username", username).
		Length("username", username, 3, 50).
		Username("username", username)

	v.Required("email", email).
		MaxLength("email", email, 255).
		Email("email", email)

	v.Required("password", password).
		Length("password", password, 8, 72).
		Password("password", password)

	if displayName != "" {
		v.MaxLength("display_name", displayName, 100)
	}

	return v.Errors()
}

func ValidateLoginRequest(login, password string) ValidationErrors {
	v := New()

	v.Required("login", login).MaxLength("login", login, 255)
	v.Required("password", password)

	return v.Errors()
}

func ValidateUpdateUserRequest(displayName, bio, status string) ValidationErrors {
	v := New()

	if displayName != "" {
		v.MaxLength("display_name", displayName, 100)
	}

	if bio != "" {
		v.MaxLength("bio", bio, 500)
	}

	if status != "" {
		v.OneOf("status", status, []string{"online", "offline", "away", "busy"})
	}

	return v.Errors()
}
