@echo off
rem Startet Viovi: lokaler Server + Browser
start "" http://localhost:8080
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
