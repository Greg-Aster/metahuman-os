# RunPod Trainer Image with SSH and Unsloth
# Base image provides CUDA 12.8 + PyTorch 2.8.0 on Ubuntu 24.04
FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WORKDIR=/workspace \
    VENV_DIR=/workspace/unsloth-venv \
    SSH_USER=root

WORKDIR ${WORKDIR}

# System packages and OpenSSH server
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssh-server git ca-certificates ninja-build && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/run/sshd /output/adapter /workspace/input

# Configure sshd for key-only auth
RUN sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config

# Python venv with Unsloth + deps
# Build xformers from source for RTX 5090 compatibility
RUN python3 -m venv ${VENV_DIR} && \
    ${VENV_DIR}/bin/pip install --upgrade pip setuptools wheel && \
    ${VENV_DIR}/bin/pip install ninja && \
    ${VENV_DIR}/bin/pip install -v \
      "git+https://github.com/facebookresearch/xformers.git@main#egg=xformers" && \
    ${VENV_DIR}/bin/pip install --no-cache-dir \
      unsloth \
      transformers \
      datasets \
      accelerate \
      peft \
      bitsandbytes

# Training script
COPY train_unsloth.py /workspace/train_unsloth.py

# Startup script for SSH key injection and daemon
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/start.sh"]

