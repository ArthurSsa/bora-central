@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
if errorlevel 1 echo.& echo Nao deu para criar a tarefa. Clique com o botao direito em instalar.bat e escolha "Executar como administrador".
pause
