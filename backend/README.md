# Barber Queue Backend

Node.js + Express + MySQL API, arranged in MVC-style layers:

```text
backend/
  src/
    config/        # DB + mail configuration
    models/        # data/auth access logic
    controllers/   # request/response orchestration
    routes/        # HTTP endpoints
    middleware/    # authentication/authorization
    server.js      # application entry point
```

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Run `database/schema.sql` in MySQL before starting the API.

## OTP email

Set these values in `.env`:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=your@gmail.com
EMAIL_APP_PASSWORD=your-google-app-password
EMAIL_FROM="Barber Queue <your@gmail.com>"
OTP_TTL_MINUTES=5
```

Do not commit `.env` or app passwords.
