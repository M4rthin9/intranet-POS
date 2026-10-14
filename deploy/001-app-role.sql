\set ECHO none
\getenv app_password APP_DATABASE_PASSWORD
CREATE ROLE ccida_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE ccida TO ccida_app;
GRANT USAGE ON SCHEMA public TO ccida_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ccida_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ccida_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ccida_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ccida_app;
-- The application role does not own tables and cannot disable integrity triggers.
