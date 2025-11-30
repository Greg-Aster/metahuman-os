#!/usr/bin/env python3

"""
MetaHuman OS Shutdown Script
This script cleanly stops all MetaHuman OS services and processes
"""

import os
import sys
import subprocess
import signal
import json
import time
from pathlib import Path


def print_colored(text, color="white"):
    """Print colored text to terminal"""
    colors = {
        "red": "\033[91m",
        "green": "\033[92m",
        "yellow": "\033[93m",
        "blue": "\033[94m",
        "end": "\033[0m"
    }
    print(f"{colors.get(color, colors['white'])}{text}{colors['end']}")


def print_header():
    """Print the header"""
    print_colored("=" * 40, "blue")
    print_colored("  MetaHuman OS Shutdown Script", "blue")
    print_colored("=" * 40, "blue")
    print()


def is_process_running(pid):
    """Check if a process is running by PID"""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def kill_process(pid, name="process", force=False, timeout=5):
    """Kill a process by PID with optional force"""
    if not is_process_running(pid):
        return True

    try:
        sig = signal.SIGKILL if force else signal.SIGTERM
        os.kill(pid, sig)

        # Wait for process to exit
        for _ in range(timeout):
            if not is_process_running(pid):
                return True
            time.sleep(1)

        # Force kill if still running
        if not force and is_process_running(pid):
            os.kill(pid, signal.SIGKILL)
            time.sleep(1)

        return not is_process_running(pid)
    except (OSError, ProcessLookupError):
        return True


def find_processes_by_pattern(pattern):
    """Find PIDs matching a pattern using pgrep"""
    try:
        result = subprocess.run(
            ["pgrep", "-f", pattern],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return [int(pid) for pid in result.stdout.strip().split('\n') if pid]
    except:
        pass
    return []


def kill_processes_by_pattern(pattern, name, timeout=5):
    """Kill all processes matching a pattern"""
    pids = find_processes_by_pattern(pattern)
    if not pids:
        print_colored(f"✓ {name} not running", "green")
        return True

    print(f"Stopping {name} (PIDs: {pids})...")

    # Send SIGTERM to all
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except:
            pass

    # Wait for graceful shutdown
    for _ in range(timeout):
        pids = [p for p in pids if is_process_running(p)]
        if not pids:
            print_colored(f"✓ {name} stopped", "green")
            return True
        time.sleep(1)

    # Force kill remaining
    if pids:
        print_colored(f"! {name} didn't stop gracefully, forcing...", "yellow")
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except:
                pass
        time.sleep(1)

    remaining = [p for p in pids if is_process_running(p)]
    if remaining:
        print_colored(f"✗ Failed to stop {name} (PIDs: {remaining})", "red")
        return False

    print_colored(f"✓ {name} stopped (forced)", "green")
    return True


def stop_agents_via_cli(repo_root):
    """Stop agents using the mh CLI"""
    print("Stopping MetaHuman agents via CLI...")
    mh_cli = repo_root / "bin" / "mh"

    if mh_cli.exists():
        try:
            subprocess.run(
                [str(mh_cli), "agent", "stop", "--all"],
                cwd=repo_root,
                capture_output=True,
                timeout=30
            )
            print_colored("✓ Agents stopped via CLI", "green")
            return True
        except subprocess.TimeoutExpired:
            print_colored("! Agent stop timed out", "yellow")
        except Exception as e:
            print_colored(f"! Failed to stop agents: {e}", "yellow")
    else:
        print_colored("! mh CLI not found", "yellow")
    return False


def stop_terminal_server(repo_root):
    """Stop the terminal server"""
    print("Stopping terminal server...")
    stop_script = repo_root / "bin" / "stop-terminal"

    if stop_script.exists():
        try:
            subprocess.run(
                [str(stop_script)],
                cwd=repo_root,
                capture_output=True,
                timeout=10
            )
        except:
            pass

    kill_processes_by_pattern("terminal-server", "Terminal Server")


def cleanup_pid_files(repo_root):
    """Clean up stale PID files"""
    print("Cleaning up stale PID files...")
    pid_dir = repo_root / "logs" / "run"

    if not pid_dir.exists():
        return

    for pidfile in pid_dir.glob("*.pid"):
        try:
            pid_text = pidfile.read_text().strip()
            if pid_text:
                pid = int(pid_text)
                if not is_process_running(pid):
                    pidfile.unlink()
                    print_colored(f"✓ Removed stale PID file: {pidfile.name}", "green")
            else:
                pidfile.unlink()
        except (ValueError, OSError):
            try:
                pidfile.unlink()
            except:
                pass


def cleanup_lock_files(repo_root):
    """Clean up stale lock files"""
    print("Cleaning up stale lock files...")
    lock_dir = repo_root / "logs" / "run" / "locks"

    if not lock_dir.exists():
        return

    for lockfile in lock_dir.glob("*.lock"):
        try:
            data = json.loads(lockfile.read_text())
            pid = data.get("pid")
            if pid and not is_process_running(pid):
                lockfile.unlink()
                print_colored(f"✓ Removed stale lock file: {lockfile.name}", "green")
        except (json.JSONDecodeError, OSError):
            try:
                lockfile.unlink()
                print_colored(f"✓ Removed corrupt lock file: {lockfile.name}", "green")
            except:
                pass


def cleanup_agent_registry(repo_root):
    """Clean up agent registry, removing dead entries"""
    print("Cleaning up agent registry...")
    registry_file = repo_root / "logs" / "agents" / "running.json"

    if not registry_file.exists():
        return

    try:
        registry = json.loads(registry_file.read_text())
        clean_registry = {}

        for name, info in registry.items():
            pid = info.get("pid")
            if pid and is_process_running(pid):
                clean_registry[name] = info
            else:
                print_colored(f"✓ Removed stale registry entry: {name}", "green")

        registry_file.write_text(json.dumps(clean_registry, indent=2))
    except (json.JSONDecodeError, OSError) as e:
        print_colored(f"! Failed to clean registry: {e}", "yellow")


def main():
    """Main shutdown function"""
    print_header()

    # Get repository root
    repo_root = Path(__file__).parent.absolute()
    print(f"Repository root: {repo_root}")
    print()

    # Stop agents via CLI first
    stop_agents_via_cli(repo_root)
    print()

    # Stop specific services
    print("Stopping services...")
    kill_processes_by_pattern("scheduler-service", "Scheduler Service")
    kill_processes_by_pattern("audio-organizer", "Audio Organizer")
    kill_processes_by_pattern("brain/agents", "Background Agents")
    print()

    # Stop terminal server
    stop_terminal_server(repo_root)
    print()

    # Stop voice servers
    print("Stopping voice servers...")
    kill_processes_by_pattern("sovits", "SoVits Server")
    kill_processes_by_pattern("rvc-server", "RVC Server")
    kill_processes_by_pattern("whisper", "Whisper Server")
    kill_processes_by_pattern("kokoro", "Kokoro Server")
    print()

    # Stop web servers
    print("Stopping web servers...")
    kill_processes_by_pattern("astro dev", "Astro Dev Server")
    kill_processes_by_pattern("node dist/server/entry.mjs", "Production Server")
    print()

    # Stop Cloudflare tunnel
    kill_processes_by_pattern("cloudflared", "Cloudflare Tunnel")
    print()

    # Cleanup
    cleanup_pid_files(repo_root)
    cleanup_lock_files(repo_root)
    cleanup_agent_registry(repo_root)

    print()
    print_colored("=" * 40, "green")
    print_colored("  MetaHuman OS Shutdown Complete", "green")
    print_colored("=" * 40, "green")
    print()
    print_colored("✓ All services stopped", "green")
    print_colored("✓ Stale files cleaned up", "green")


if __name__ == "__main__":
    main()
