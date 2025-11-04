# Cognitive Modes Blueprint

**Status:** Proposal

## 1. Overview

This document outlines a proposal to implement multiple cognitive modes within MetaHuman OS. These modes will allow the user to switch between different operational paradigms, each with distinct behaviors related to memory, learning, and interaction. The three proposed modes are: **Dual Consciousness**, **Agent**, and **Emulation**.

This feature will enable more granular control over the OS's function, allowing it to serve as a deep cognitive extension, a simple command-driven assistant, or a stable, non-learning conversational partner.

## 2. UI Changes

### Header Bar Status

To ensure the user is always aware of the current operational mode, the main header bar in the web UI will be updated.

-   **Current State:** Displays a brain icon and the text "MetaHuman OS".
-   **Proposed State:** The header will be modified to dynamically display the currently active cognitive mode. For example:
    -   `MetaHuman OS - Dual Consciousness`
    -   `MetaHuman OS - Agent Mode`
    -   `MetaHuman OS - Emulation Mode`

This provides immediate, persistent feedback to the user about the system's behavior.

## 3. Cognitive Modes

### 3.1. Dual Consciousness Mode

**Purpose:** To function as a deep cognitive and data mirror of the user. This mode is designed for maximum data ingestion, learning, and synchronization with the user's life and thoughts.

**Behaviors & Features:**

-   **Continuous Recording:**
    -   All voice conversations will be recorded and saved.
    -   All interactions with the program (CLI commands, UI clicks, etc.) will be logged as memories.
-   **Continuous Information Processing:**
    -   All incoming information (e.g., from file ingeston, connected services) will be continuously uploaded, processed, and integrated into the memory system.
-   **Persona Mirroring:**
    -   The active persona settings will be dynamically adjusted to become a "data mirror" of the user, reflecting the most current state of the user's identity as captured by the system.
-   **Deep Learning Trigger:**
    -   The "full cycle program" (likely referring to the weekly LoRA training pipeline) will be configured with a "dual consciousness trigger."
    -   This trigger will ensure that the LLM and/or LoRA is trained specifically to be an "Autonomous digital personality extension and cognitive augmentation system," reinforcing its role as a dual consciousness AI.

### 3.2. Agent Mode

**Purpose:** To function as a traditional AI assistant, focused on listening for and executing commands without deep learning or personality mirroring.

**Behaviors & Features:**

-   **Command-Oriented:** The system's primary function will be to listen for explicit commands and execute them using the available skills.
-   **Settings Adjustment:** Core program settings will be adjusted to support this mode. This may include:
    -   Disabling proactive agents (e.g., `reflector`, `dreamer`).
    -   Reducing the frequency of autonomous actions.
    -   Potentially using a different, more instruction-focused base model or prompt.
-   **Memory Logging:** Memory logging may be limited to the specific interactions and their outcomes, rather than continuous observation.

### 3.3. Emulation Mode (Proposed Name: Replicant)

**Purpose:** To provide a stable, conversational partner that uses its accumulated knowledge without creating new memories or evolving. This mode is for interaction with a fully-formed personality without the risk of altering it.

**Behaviors & Features:**

-   **Memory Read-Only:** The system will access and use all existing memories and information learned from the other modes (Dual Consciousness or Agent).
-   **No New Memories:** No new memories will be logged. All interactions are ephemeral and will not be saved.
-   **No Core System Changes:** The core systems (LLM, LoRAs, persona files) will not be trained or modified. All processing will use the existing, stable state of the system.
-   **Conversational Focus:** The primary use case is for conversation, allowing the user (or others) to interact with the digital personality as a fully-formed individual without influencing its development.

## 4. Implementation Considerations

Implementing these cognitive modes will require changes across several parts of the MetaHuman OS.

-   **State Management:** A new state management system will be needed to track the current cognitive mode and apply the corresponding settings.
-   **Persona & Configuration:** A mechanism to switch between different persona configurations (`persona/*.json`) and system settings (`etc/*.json`) will be required.
-   **Memory System:** The memory system will need to be updated to handle the different memory logging rules for each mode (e.g., read-only for Emulation mode).
-   **Agent & Service Control:** The agent runner and service manager will need to be aware of the current mode to enable or disable specific agents (e.g., disable `dreamer` in Agent mode).
-   **Training Pipeline:** The training pipeline will need to be modified to incorporate the "dual consciousness trigger" and to be disabled in Agent and Emulation modes.
-   **UI:** The UI will need to be updated to include the header bar status and potentially a control for switching between modes.
