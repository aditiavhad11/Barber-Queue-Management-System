# Password + OTP Authentication

The authentication flow now supports:

- Registration: name + email + password, then OTP verification.
- Login: password login OR OTP login.
- Existing JWT session remains in localStorage, so refreshing an authenticated dashboard does not require a new OTP.
- Existing accounts without a password can continue using OTP. New registrations get a password automatically.

The backend also prepares the `users.password_hash` column automatically when it starts. The SQL migration is included at `database/migrations/add_password_auth.sql` for reference/manual database setup.

Password hashes use bcrypt and plain-text passwords are not stored in MySQL.
