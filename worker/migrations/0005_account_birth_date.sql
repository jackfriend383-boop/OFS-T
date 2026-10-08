-- Store the birth date used for the minimum-age check on customer accounts and pending sign-in links.
ALTER TABLE users ADD COLUMN birth_date TEXT;
ALTER TABLE login_links ADD COLUMN birth_date TEXT;
