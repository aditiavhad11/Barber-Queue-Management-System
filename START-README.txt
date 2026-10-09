BARBER QUEUE - QUICK START

1. Create backend/.env from backend/.env.example.
2. Put your MySQL password/database settings in backend/.env.
3. For real email OTP, put your Gmail SMTP/App Password in backend/.env.
   If email SMTP is not configured, backend uses DEV_OTP=123456 for local testing.
4. Make sure the barber_queue database/schema.sql has been imported.
5. Run START.bat, or run backend and frontend separately.

6. Frontend: http://localhost:5173
   Backend:  http://localhost:4000/api/health

ADMIN
- Get Started now has Administrator.
- Admin sign-in uses ADMIN_EMAIL from backend/.env.
- Default example: admin@barberqueue.local

IMPORTANT
- Real email OTP requires valid EMAIL_HOST/EMAIL_USER/EMAIL_APP_PASSWORD.
- The development OTP fallback is only for local testing when SMTP is not configured.
