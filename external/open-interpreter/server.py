#!/usr/bin/env python3
"""
Open Interpreter Server for MetaHuman OS

A FastAPI HTTP server that wraps Open Interpreter, allowing MetaHuman's
TypeScript codebase to execute tool-based tasks via HTTP API.

Key Design:
- Connects to MetaHuman's LLM proxy at configurable endpoint
- Model selection is controlled by MetaHuman settings (NOT hardcoded)
- Supports streaming output via SSE
- Graceful shutdown and error handling
"""

import asyncio
import json
import os
import sys
import traceback
from datetime import datetime
from typing import Any, AsyncGenerator, Dict, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
import uvicorn

# ============================================================================
# Configuration Models
# ============================================================================

class LLMConfig(BaseModel):
    """LLM configuration - controlled by MetaHuman settings"""
    api_base: str = Field(
        default="http://localhost:4321/api/llm/proxy",
        description="MetaHuman LLM proxy endpoint"
    )
    api_key: str = Field(
        default="mh-internal",
        description="API key (placeholder for proxy auth)"
    )
    model: str = Field(
        default="metahuman-proxy",
        description="Model identifier (proxy handles actual selection)"
    )
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1)


class InterpreterConfig(BaseModel):
    """Interpreter behavior configuration"""
    safe_mode: bool = Field(default=True, description="Require confirmation for code execution")
    auto_run: bool = Field(default=False, description="Auto-run generated code (dangerous!)")
    max_iterations: int = Field(default=10, ge=1, le=50)
    timeout: int = Field(default=120, ge=10, le=600, description="Execution timeout in seconds")
    allowed_languages: List[str] = Field(
        default=["python", "shell", "javascript"],
        description="Languages allowed for code execution"
    )
    working_directory: Optional[str] = Field(
        default=None,
        description="Working directory for code execution"
    )


class ServerConfig(BaseModel):
    """Full server configuration"""
    llm: LLMConfig = Field(default_factory=LLMConfig)
    interpreter: InterpreterConfig = Field(default_factory=InterpreterConfig)


# ============================================================================
# Request/Response Models
# ============================================================================

class ConfigureRequest(BaseModel):
    """Request to reconfigure the interpreter"""
    llm: Optional[LLMConfig] = None
    interpreter: Optional[InterpreterConfig] = None


class ExecuteRequest(BaseModel):
    """Request to execute a task"""
    prompt: str = Field(..., min_length=1, description="Task to execute")
    context: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional context (goal, scratchpad, etc.)"
    )
    streaming: bool = Field(default=True, description="Stream output via SSE")
    system_message: Optional[str] = Field(
        default=None,
        description="Custom system message"
    )


class ExecuteResponse(BaseModel):
    """Response from task execution"""
    success: bool
    outputs: List[Dict[str, Any]] = Field(default_factory=list)
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    error: Optional[str] = None
    execution_time_ms: int = 0


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    interpreter_ready: bool
    config: Dict[str, Any]
    uptime_seconds: float


# ============================================================================
# Global State
# ============================================================================

config = ServerConfig()
interpreter = None
start_time = datetime.now()
execution_lock = asyncio.Lock()
current_execution_task: Optional[asyncio.Task] = None


# ============================================================================
# Interpreter Management
# ============================================================================

def create_interpreter(cfg: ServerConfig):
    """Create and configure an Open Interpreter instance"""
    try:
        from interpreter import Interpreter
    except ImportError:
        raise RuntimeError(
            "Open Interpreter not installed. Run: pip install open-interpreter"
        )

    i = Interpreter()

    # Configure LLM to use MetaHuman proxy
    i.llm.model = cfg.llm.model
    i.llm.api_base = cfg.llm.api_base
    i.llm.api_key = cfg.llm.api_key
    i.llm.temperature = cfg.llm.temperature
    i.llm.max_tokens = cfg.llm.max_tokens

    # Configure behavior
    i.auto_run = cfg.interpreter.auto_run
    i.safe_mode = "off" if not cfg.interpreter.safe_mode else "ask"

    # Set allowed languages if supported
    if hasattr(i, 'allowed_languages'):
        i.allowed_languages = cfg.interpreter.allowed_languages

    return i


def get_interpreter():
    """Get or create interpreter instance"""
    global interpreter
    if interpreter is None:
        interpreter = create_interpreter(config)
    return interpreter


def reset_interpreter():
    """Reset interpreter state"""
    global interpreter
    interpreter = None


# ============================================================================
# FastAPI Application
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    # Startup
    print(f"[interpreter-server] Starting Open Interpreter server...")
    print(f"[interpreter-server] LLM Proxy: {config.llm.api_base}")
    print(f"[interpreter-server] Safe Mode: {config.interpreter.safe_mode}")
    print(f"[interpreter-server] Auto Run: {config.interpreter.auto_run}")

    yield

    # Shutdown
    print("[interpreter-server] Shutting down...")
    reset_interpreter()


app = FastAPI(
    title="Open Interpreter Server",
    description="MetaHuman OS Tool Execution Layer",
    version="1.0.0",
    lifespan=lifespan
)

# CORS for MetaHuman web UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4321", "http://localhost:4322", "http://127.0.0.1:4321"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint"""
    uptime = (datetime.now() - start_time).total_seconds()
    return HealthResponse(
        status="healthy",
        interpreter_ready=interpreter is not None,
        config={
            "llm_api_base": config.llm.api_base,
            "safe_mode": config.interpreter.safe_mode,
            "auto_run": config.interpreter.auto_run,
            "max_iterations": config.interpreter.max_iterations,
        },
        uptime_seconds=uptime
    )


@app.post("/configure")
async def configure(request: ConfigureRequest):
    """Reconfigure the interpreter with new settings"""
    global config, interpreter

    if request.llm:
        config.llm = request.llm
    if request.interpreter:
        config.interpreter = request.interpreter

    # Reset interpreter to pick up new config
    reset_interpreter()

    return {
        "success": True,
        "config": config.model_dump()
    }


@app.post("/execute", response_model=ExecuteResponse)
async def execute(request: ExecuteRequest):
    """Execute a task via Open Interpreter"""
    global current_execution_task

    async with execution_lock:
        start = datetime.now()

        try:
            i = get_interpreter()

            # Set custom system message if provided
            if request.system_message:
                i.system_message = request.system_message
            elif request.context:
                # Build system message from context
                i.system_message = build_system_message(request.context)

            # Execute the task
            outputs = []
            messages = []

            if request.streaming:
                # For now, collect all streaming output
                # TODO: Implement SSE endpoint for true streaming
                for chunk in i.chat(request.prompt, stream=True, display=False):
                    outputs.append(chunk)
            else:
                result = i.chat(request.prompt, display=False)
                if isinstance(result, list):
                    messages = result
                else:
                    messages = [{"role": "assistant", "content": str(result)}]

            # Get conversation history
            if hasattr(i, 'messages'):
                messages = i.messages[-10:]  # Last 10 messages

            execution_time = int((datetime.now() - start).total_seconds() * 1000)

            return ExecuteResponse(
                success=True,
                outputs=outputs,
                messages=messages,
                execution_time_ms=execution_time
            )

        except Exception as e:
            traceback.print_exc()
            execution_time = int((datetime.now() - start).total_seconds() * 1000)
            return ExecuteResponse(
                success=False,
                error=str(e),
                execution_time_ms=execution_time
            )


@app.post("/execute/stream")
async def execute_stream(request: ExecuteRequest):
    """Execute a task with Server-Sent Events streaming"""

    async def generate() -> AsyncGenerator[str, None]:
        try:
            i = get_interpreter()

            if request.system_message:
                i.system_message = request.system_message
            elif request.context:
                i.system_message = build_system_message(request.context)

            # Stream chunks via SSE
            for chunk in i.chat(request.prompt, stream=True, display=False):
                event_data = json.dumps({
                    "type": "chunk",
                    "data": chunk
                })
                yield f"data: {event_data}\n\n"

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            error_data = json.dumps({
                "type": "error",
                "error": str(e)
            })
            yield f"data: {error_data}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/stop")
async def stop():
    """Stop current execution"""
    global current_execution_task

    if current_execution_task and not current_execution_task.done():
        current_execution_task.cancel()
        return {"success": True, "message": "Execution cancelled"}

    return {"success": True, "message": "No execution in progress"}


@app.post("/reset")
async def reset():
    """Reset interpreter state (clear conversation history)"""
    reset_interpreter()
    return {"success": True, "message": "Interpreter reset"}


# ============================================================================
# Helper Functions
# ============================================================================

def build_system_message(context: Dict[str, Any]) -> str:
    """Build system message from execution context"""
    parts = [
        "You are a tool execution assistant for MetaHuman OS.",
        "Execute the requested task using code when necessary.",
        "Be concise and focus on completing the task."
    ]

    if "goal" in context:
        parts.append(f"\nCurrent Goal: {context['goal']}")

    if "working_directory" in context:
        parts.append(f"\nWorking Directory: {context['working_directory']}")

    if "scratchpad" in context and context["scratchpad"]:
        parts.append("\nPrevious Steps:")
        for step in context["scratchpad"][-5:]:  # Last 5 steps
            if "thought" in step:
                parts.append(f"- {step['thought']}")

    return "\n".join(parts)


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Run the server"""
    port = int(os.environ.get("INTERPRETER_PORT", "4325"))
    host = os.environ.get("INTERPRETER_HOST", "127.0.0.1")

    # Allow configuration via environment
    if os.environ.get("INTERPRETER_LLM_PROXY"):
        config.llm.api_base = os.environ["INTERPRETER_LLM_PROXY"]

    if os.environ.get("INTERPRETER_AUTO_RUN", "").lower() == "true":
        config.interpreter.auto_run = True
        config.interpreter.safe_mode = False

    print(f"[interpreter-server] Starting on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
