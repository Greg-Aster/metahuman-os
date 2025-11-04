#!/usr/bin/env python3

"""
MetaHuman OS Startup Script
This script provides a guided startup process for MetaHuman OS
"""

import os
import sys
import subprocess
import platform
import shutil
import time
from pathlib import Path

def print_colored(text, color="white"):
    """Print colored text to terminal"""
    colors = {
        "red": "\033[91m",
        "green": "\033[92m", 
        "yellow": "\033[93m",
        "blue": "\033[94m",
        "purple": "\033[95m",
        "cyan": "\033[96m",
        "white": "\033[97m",
        "end": "\033[0m"
    }
    print(f"{colors.get(color, colors['white'])}{text}{colors['end']}")

def print_header():
    """Print the header for the startup script"""
    print_colored("=" * 50, "blue")
    print_colored("  MetaHuman OS Startup Script", "blue")
    print_colored("=" * 50, "blue")
    print()

def create_virtual_environment(repo_root):
    """Create Python virtual environment if it doesn't exist"""
    venv_path = repo_root / "venv"
    
    if not venv_path.exists():
        print_colored("Creating Python virtual environment...", "yellow")
        try:
            # Create virtual environment
            subprocess.run([sys.executable, "-m", "venv", str(venv_path)], check=True)
            
            # Upgrade pip in the new environment
            if platform.system() == "Windows":
                python_exe = venv_path / "Scripts" / "python.exe"
            else:
                python_exe = venv_path / "bin" / "python3"
                
            subprocess.run([str(python_exe), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], check=True)
            
            print_colored(f"✓ Virtual environment created at {venv_path}", "green")
            return str(python_exe)
        except subprocess.CalledProcessError:
            print_colored("✗ Failed to create virtual environment", "red")
            return None
    else:
        print_colored("✓ Virtual environment already exists", "green")
        
        # Get Python executable path
        if platform.system() == "Windows":
            python_exe = venv_path / "Scripts" / "python.exe"
        else:
            python_exe = venv_path / "bin" / "python3"
            
        return str(python_exe) if python_exe.exists() else None

def activate_virtual_environment(repo_root):
    """Activate Python virtual environment"""
    venv_path = repo_root / "venv"
    
    if venv_path.exists():
        if platform.system() == "Windows":
            python_exe = venv_path / "Scripts" / "python.exe"
        else:
            python_exe = venv_path / "bin" / "python3"
            
        if python_exe.exists():
            print_colored(f"✓ Virtual environment found at {venv_path}", "green")
            return str(python_exe)
    
    print_colored("! No virtual environment found", "yellow")
    return None

def install_python_dependencies(repo_root):
    """Install Python dependencies from requirements.txt"""
    requirements_file = repo_root / "requirements.txt"
    
    if not requirements_file.exists():
        print_colored("! requirements.txt not found - skipping Python dependency installation", "yellow")
        return True
        
    venv_path = repo_root / "venv"
    if not venv_path.exists():
        print_colored("! Virtual environment not found - cannot install Python dependencies", "red")
        return False
        
    # Get Python executable from virtual environment
    if platform.system() == "Windows":
        python_exe = venv_path / "Scripts" / "python.exe"
    else:
        python_exe = venv_path / "bin" / "python3"
        
    if not python_exe.exists():
        print_colored("! Python executable not found in virtual environment", "red")
        return False
        
    # Check if dependencies are already installed
    installed_marker = venv_path / "installed_packages"
    if installed_marker.exists() and requirements_file.stat().st_mtime < installed_marker.stat().st_mtime:
        print_colored("✓ Python dependencies already installed", "green")
        return True
        
    print_colored("Installing Python dependencies from requirements.txt...", "yellow")
    try:
        subprocess.run([str(python_exe), "-m", "pip", "install", "-r", str(requirements_file)], check=True)
        # Create marker file to indicate successful installation
        installed_marker.touch()
        print_colored("✓ Python dependencies installed", "green")
        return True
    except subprocess.CalledProcessError:
        print_colored("✗ Failed to install Python dependencies", "red")
        return False

def check_tools():
    """Check if required tools are installed"""
    tools = ["node", "pnpm"]
    missing = []
    
    for tool in tools:
        if not shutil.which(tool):
            missing.append(tool)
        else:
            try:
                result = subprocess.run([tool, "--version"], 
                                      capture_output=True, text=True, timeout=5)
                version = result.stdout.strip() if result.returncode == 0 else "unknown"
                print_colored(f"✓ {tool} ({version})", "green")
            except:
                print_colored(f"✓ {tool}", "green")
    
    if missing:
        print_colored(f"Missing required tools: {', '.join(missing)}", "red")
        print_colored("Please install:", "yellow")
        for tool in missing:
            if tool == "node":
                print("  - Node.js from https://nodejs.org/")
            elif tool == "pnpm":
                print("  - pnpm: npm install -g pnpm")
        return False
    
    # Check Python version
    python_version = sys.version.split()[0]
    print_colored(f"✓ python ({python_version})", "green")
    
    return True

def check_ollama():
    """Check if Ollama is running"""
    try:
        result = subprocess.run(["ollama", "list"], 
                               capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print_colored("✓ Ollama is running", "green")
            return True
        else:
            print_colored("! Ollama is installed but not running", "yellow")
            return False
    except:
        print_colored("! Ollama not found", "yellow")
        print_colored("  The web interface may have limited functionality", "yellow")
        print_colored("  Install Ollama from: https://ollama.ai", "yellow")
        return False

def initialize_metahuman(repo_root):
    """Initialize MetaHuman OS if not already initialized"""
    persona_core = repo_root / "persona" / "core.json"
    
    if not persona_core.exists():
        print_colored("Initializing MetaHuman OS...", "yellow")
        try:
            subprocess.run(["./bin/mh", "init"], cwd=repo_root, check=True)
            print_colored("✓ MetaHuman initialized", "green")
            print_colored("Remember to customize your persona in persona/core.json", "yellow")
            return True
        except subprocess.CalledProcessError:
            print_colored("✗ Failed to initialize MetaHuman", "red")
            return False
    else:
        print_colored("✓ MetaHuman already initialized", "green")
        return True

def install_dependencies(repo_root):
    """Install Node.js dependencies if needed"""
    node_modules = repo_root / "node_modules"
    site_node_modules = repo_root / "apps" / "site" / "node_modules"
    
    if not node_modules.exists() or not site_node_modules.exists():
        print_colored("Installing Node.js dependencies...", "yellow")
        try:
            subprocess.run(["pnpm", "install"], cwd=repo_root, check=True)
            print_colored("✓ Dependencies installed", "green")
            return True
        except subprocess.CalledProcessError:
            print_colored("✗ Failed to install dependencies", "red")
            return False
    else:
        print_colored("✓ Node.js dependencies already installed", "green")
        return True

def start_web_server(repo_root):
    """Start the web server"""
    site_dir = repo_root / "apps" / "site"
    
    print_colored("\n" + "=" * 50, "blue")
    print_colored("  Starting MetaHuman OS Web Interface", "blue")
    print_colored("=" * 50, "blue")
    print()
    print_colored("URL: http://localhost:4321", "green")
    print_colored("Press Ctrl+C to stop the server", "yellow")
    print()
    print_colored("Features available:", "cyan")
    print("  - Chat with your digital personality")
    print("  - Task management")
    print("  - Memory browsing")
    print("  - Persona customization")
    print("  - Agent monitoring")
    print()
    
    try:
        # Change to the site directory and start the dev server
        os.chdir(site_dir)
        subprocess.run(["pnpm", "dev"], check=True)
        return True
    except KeyboardInterrupt:
        print_colored("\n\nServer stopped by user", "yellow")
        return True
    except subprocess.CalledProcessError as e:
        print_colored(f"\n✗ Failed to start web server: {e}", "red")
        return False

def main():
    """Main function"""
    print_header()
    
    # Get repository root
    script_path = Path(__file__).parent.absolute()
    repo_root = script_path
    
    print(f"Repository root: {repo_root}")
    print()
    
    # Create virtual environment if it doesn't exist
    print("Setting up Python virtual environment...")
    venv_python = create_virtual_environment(repo_root)
    if venv_python:
        print(f"Using virtual environment Python: {venv_python}")
    print()
    
    # Install Python dependencies
    print("Installing Python dependencies...")
    if not install_python_dependencies(repo_root):
        print_colored("Warning: Could not install Python dependencies", "yellow")
    print()
    
    # Check required tools
    print("Checking for required tools...")
    if not check_tools():
        sys.exit(1)
    print()
    
    # Check Ollama
    print("Checking Ollama status...")
    check_ollama()
    print()
    
    # Install dependencies
    print("Installing Node.js dependencies...")
    if not install_dependencies(repo_root):
        sys.exit(1)
    print()
    
    # Initialize MetaHuman
    print("Initializing MetaHuman OS...")
    if not initialize_metahuman(repo_root):
        sys.exit(1)
    print()
    
    # Ask user if they want to start the web server
    response = input("Do you want to start the web server? (Y/n): ").strip().lower()
    if response in ["", "y", "yes"]:
        start_web_server(repo_root)
    else:
        print_colored("Startup script completed. You can start the web server later with:", "yellow")
        print("  cd apps/site && pnpm dev")
        print("  Then open http://localhost:4321")

if __name__ == "__main__":
    main()