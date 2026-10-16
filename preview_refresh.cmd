@echo off
rem One-command local preview of the site-refresh branch.
rem Builds the app and the server, then serves dist through the real Express
rem server at http://localhost:4173 with ORDER PLACEMENT DISABLED.
rem   preview_refresh.cmd             build + serve
rem   preview_refresh.cmd --no-build  serve the existing build
rem   preview_refresh.cmd --port 4180 use another port
rem Stop with Ctrl+C. See scripts\preview_refresh.mjs for why it cannot trade.
cd /d "%~dp0"
node scripts\preview_refresh.mjs %*
