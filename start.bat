@echo off
title MetaHuman OS Startup

setlocal EnableDelayedExpansion

REM MetaHuman OS Startup Script for Windows
REM This script initializes and starts the MetaHuman OS web interface

echo ===================================
echo   MetaHuman OS Startup Script     
echo ===================================
echo.

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set REPO_ROOT=%SCRIPT_DIR:~0,-1%

if exist "%REPO_ROOT%\.start-config" (
    for /f "usebackq tokens=1* delims==" %%A in ("%REPO_ROOT%\.start-config") do (
        set "key=%%A"
        set "val=%%B"
        if not "!key!"=="" (
            if not "!key:~0,1!"=="#" (
                if not defined !key! set !key!=!val!
            )
        )
    )
)

if not defined SKIP_DEP_INSTALL set SKIP_DEP_INSTALL=0
if not defined SKIP_PYTHON_DEPS set SKIP_PYTHON_DEPS=%SKIP_DEP_INSTALL%
if not defined SKIP_NODE_DEPS set SKIP_NODE_DEPS=%SKIP_DEP_INSTALL%

echo Repository root: %REPO_ROOT%
echo.

REM Check if we're in the right directory structure
if not exist "%REPO_ROOT%\package.json" (
    echo ERROR: package.json not found in repository root
    echo Make sure you're running this script from the MetaHuman OS root directory
    echo Current directory: %REPO_ROOT%
    pause
    exit /b 1
)

if not exist "%REPO_ROOT%\apps\site" (
    echo ERROR: apps/site directory not found
    echo Make sure you're running this script from the MetaHuman OS root directory
    echo Current directory: %REPO_ROOT%
    pause
    exit /b 1
)

REM Check for required tools
echo Checking for required tools...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo âœ“ node (%NODE_VERSION%)
)

where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: pnpm not found
    echo Please install pnpm: npm install -g pnpm
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('pnpm --version') do set PNPM_VERSION=%%i
    echo âœ“ pnpm (%PNPM_VERSION%)
)

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Python not found
    echo Please install Python from https://python.org/
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('python --version') do set PYTHON_VERSION=%%i
    echo âœ“ python (%PYTHON_VERSION%)
)

echo.

REM Create Python virtual environment if it doesn't exist
set VENV_PATH=%REPO_ROOT%\venv
if not exist "%VENV_PATH%" (
    echo Creating Python virtual environment...
    python -m venv "%VENV_PATH%"
    if !ERRORLEVEL! neq 0 (
        echo ERROR: Failed to create virtual environment
        pause
        exit /b 1
    )
    echo âœ“ Virtual environment created at %VENV_PATH%
    echo.
)

REM Activate virtual environment
echo Activating Python virtual environment...
call "%VENV_PATH%\Scripts\activate.bat"
if !ERRORLEVEL! neq 0 (
    echo ERROR: Failed to activate virtual environment
    pause
    exit /b 1
)
echo âœ“ Virtual environment activated
echo.

REM Upgrade pip in virtual environment
echo Upgrading pip in virtual environment...
python -m pip install --upgrade pip setuptools wheel >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo WARNING: Failed to upgrade pip
) else (
    echo âœ“ Pip upgraded
)
echo.

REM Install Python dependencies if requirements.txt exists
if "%SKIP_PYTHON_DEPS%"=="1" (
    echo WARNING: Skipping Python dependency installation (SKIP_PYTHON_DEPS=1)
    echo.
) else if exist "%REPO_ROOT%\requirements.txt" (
    echo Checking Python dependencies...
    set REQUIREMENTS_FILE=%REPO_ROOT%\requirements.txt
    set INSTALLED_MARKER=%VENV_PATH%\installed_packages
    
    REM Check if dependencies need to be installed
    if not exist "%INSTALLED_MARKER%" (
        echo Installing Python dependencies from requirements.txt...
        python -m pip install -r "%REQUIREMENTS_FILE%"
        if !ERRORLEVEL! neq 0 (
            echo ERROR: Failed to install Python dependencies
            pause
            exit /b 1
        )
        echo. > "%INSTALLED_MARKER%"
        echo âœ“ Python dependencies installed
        echo.
    ) else (
        REM Compare timestamps to see if requirements.txt is newer
        for /f %%i in ('powershell -command "(Get-Item ''%REQUIREMENTS_FILE%'').LastWriteTime.Ticks"') do set REQ_TIME=%%i
        for /f %%i in ('powershell -command "(Get-Item ''%INSTALLED_MARKER%'').LastWriteTime.Ticks"') do set MARKER_TIME=%%i
        
        if !REQ_TIME! gtr !MARKER_TIME! (
            echo Updating Python dependencies from requirements.txt...
            python -m pip install -r "%REQUIREMENTS_FILE%"
            if !ERRORLEVEL! neq 0 (
                echo ERROR: Failed to update Python dependencies
                pause
                exit /b 1
            )
            echo. > "%INSTALLED_MARKER%"
            echo âœ“ Python dependencies updated
            echo.
        ) else (
            echo âœ“ Python dependencies already installed
            echo.
        )
    )
) else (
    echo WARNING: requirements.txt not found - skipping Python dependency installation
    echo.
)

REM Check if Ollama is running
echo Checking Ollama status...
where ollama >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo WARNING: Ollama not found
    echo The web interface may have limited functionality
    echo Install Ollama from: https://ollama.ai
    echo.
) else (
    ollama list >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        echo âœ“ Ollama is running
    ) else (
        echo WARNING: Ollama is installed but not running
        echo The web interface may have limited functionality
        echo.
    )
)

REM Check if we need to install dependencies
echo Checking for Node.js dependencies...
set LOCK_FILE=%REPO_ROOT%\pnpm-lock.yaml
set STAMP_FILE=%REPO_ROOT%\node_modules\.install-stamp
set NEED_INSTALL=0

if not exist "%REPO_ROOT%\node_modules" set NEED_INSTALL=1
if not exist "%REPO_ROOT%\apps\site\node_modules" set NEED_INSTALL=1

if %NEED_INSTALL%==0 (
    if exist "%LOCK_FILE%" (
        if not exist "%STAMP_FILE%" (
            set NEED_INSTALL=1
        ) else (
            for /f %%i in ('powershell -NoProfile -Command "(Get-Item ''%LOCK_FILE%'').LastWriteTimeUtc.Ticks"') do set LOCK_TIME=%%i
            for /f %%i in ('powershell -NoProfile -Command "(Get-Item ''%STAMP_FILE%'').LastWriteTimeUtc.Ticks"') do set STAMP_TIME=%%i
            if %LOCK_TIME% GTR %STAMP_TIME% (
                set NEED_INSTALL=1
            )
        )
    )
)

if %NEED_INSTALL%==1 (
    echo Installing Node.js dependencies...
    cd /d "%REPO_ROOT%"
    call pnpm install
    if not exist "%REPO_ROOT%\node_modules" mkdir "%REPO_ROOT%\node_modules" >nul 2>&1
    type nul > "%STAMP_FILE%"
    echo âœ“ Dependencies installed
    echo.
) else (
    echo âœ“ Node.js dependencies already installed
    echo.
)

REM Check if MetaHuman is initialized
echo Checking MetaHuman initialization...
if not exist "%REPO_ROOT%\persona\core.json" (
    echo WARNING: MetaHuman not initialized
    echo Initializing MetaHuman OS...
    cd /d "%REPO_ROOT%"
    call .\bin\mh init
    echo âœ“ MetaHuman initialized
    echo.
    echo REMEMBER: Customize your persona in persona\core.json
    echo.
) else (
    echo âœ“ MetaHuman already initialized
    echo.
)

REM Start the web server
echo Starting MetaHuman OS web interface...
echo.

cd /d "%REPO_ROOT%\apps\site"

REM Check if production build exists
if not exist "%REPO_ROOT%\apps\site\dist\server\entry.mjs" (
    echo Building production bundle...
    call pnpm build
    if %ERRORLEVEL% neq 0 (
        echo ERROR: Build failed. Falling back to development server.
        call pnpm dev
        pause
        exit /b 1
    )
    echo Production build complete
    echo.
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "while (-not (Test-NetConnection localhost -Port 4321 -InformationLevel Quiet)) { Start-Sleep 1 } ; Start-Process 'http://localhost:4321'" >nul 2>&1

echo ==================================
echo   MetaHuman OS Production Server
echo ==================================
echo URL: http://localhost:4321
echo Press Ctrl+C to stop the server
echo.
echo Features available:
echo   - Chat with your digital personality
echo   - Task management
echo   - Memory browsing
echo   - Persona customization
echo   - Agent monitoring
echo.
echo To stop the server, press Ctrl+C
echo ==================================
echo.

REM Start the production server
node dist\server\entry.mjs

pause
