# Use an official NVIDIA CUDA base image compatible with cu121
# See https://hub.docker.com/r/nvidia/cuda for available tags
# Using a runtime image and adding dev tools is often smaller than using the full devel image
FROM nvidia/cuda:12.1.1-devel-ubuntu22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install Python, pip, git, build essentials, and other common tools
# update Install Python 3.12 from deadsnakes PPA and other tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    software-properties-common \
    build-essential \
    cmake \
    git \
    wget \
    && \
    add-apt-repository ppa:deadsnakes/ppa -y && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    python3.12 \
    python3.12-venv \
    && \
    rm -rf /var/lib/apt/lists/*

RUN python3.12 -m ensurepip --upgrade

RUN ln -sf /usr/bin/python3.12 /usr/bin/python3 && \
    ln -sf /usr/bin/pip3 /usr/bin/pip

RUN python3.12 -m pip install --upgrade pip setuptools wheel && \
    rm -rf /root/.cache/pip

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu121 torch==2.6.0 torchaudio==2.6.0 torchvision==0.21.0 && \
    pip install --no-cache-dir -r requirements.txt && \
    rm -rf /root/.cache/pip

# --- Optional: Copy your project code if needed inside the container ---
# If your training script needs access to project code (beyond just config/dataset)
# COPY . /app

# --- Set default command (optional) ---
# This command runs if you start the container without specifying another command
# Useful for keeping the container running or providing a default shell
CMD ["/bin/bash"]