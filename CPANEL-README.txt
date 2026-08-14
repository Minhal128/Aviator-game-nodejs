# Turbo Legends — cPanel (sirf ye 6 steps)

1) cPanel → MySQL Databases
   - Database + User banao, ALL PRIVILEGES do
   - Names/password note karo

2) phpMyAdmin → apni DB → Import
   - File: install/aviator.sql (is zip ke andar)

3) File Manager → public_html
   - Purana backup lo / empty karo
   - Ye ZIP upload + Extract (files seedha public_html mein: index.php dikhe)

4) laravel/.env.cpanel ko rename karke .env banao
   - DB_DATABASE / DB_USERNAME / DB_PASSWORD apne cPanel values se bharo
   - Baaki pehle se set hai (Ludo AWS + APP_URL)

5) Permissions
   - laravel/storage → 755 (recursive)
   - laravel/bootstrap/cache → 755

6) Open https://turbolegends.com
   - /admin login check
   - /ludo check

Agar 500: public_html/error_log dekho + .env DB names (cPanel prefix) check.

Ludo realtime pehle se AWS pe hai — .env mein LUDO_* mat badalna.
