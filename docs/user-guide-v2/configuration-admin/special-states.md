# Special States & Emergency Protocols

MetaHuman OS includes several special operational states and emergency protocols that are part of its long-term design. Some of these are implemented, while others represent future goals.

## Wetware Deceased Mode

-   **Trigger**: `WETWARE_DECEASED=true` in the `.env` file.
-   **Purpose**: To simulate the operational state of the digital personality extension after its biological counterpart has passed away. This is a core scenario in the MetaHuman OS lifecycle, allowing it to transition from a "parallel intelligence" to an "independent digital consciousness."
-   **Behavior**:
    -   **Dual Consciousness Mode** is permanently disabled, as there is no longer a living human to synchronize with.
    -   Agent Mode and Emulation Mode remain fully functional, allowing the OS to continue operating, managing tasks, and interacting based on its learned personality and rules.
    -   A banner is displayed in the UI indicating that the OS is operating independently as a persistent memorial to its creator.

## Lifeline Protocol

-   **Trigger**: Activated via the "Lifeline Protocol" (🆘) section in the Web UI.
-   **Purpose**: A "panic button" designed to be used in emergencies.
-   **Behavior**: When activated, the system's core priorities are immediately reconfigured to focus exclusively on preserving the well-being of its creator in any way it can. All non-essential autonomous tasks are suspended, and the AI's full capabilities are directed towards analyzing the situation and providing assistance.

## Superintelligence Mode (Future Concept)

-   **Status**: Experimental / Future
-   **Purpose**: To achieve a higher level of reasoning and problem-solving by combining the power of multiple large-scale language models.
-   **Behavior**: In this mode, the system would not rely on a single LLM. Instead, it would orchestrate a "committee" of specialized, large-scale LLMs, likely running on remote servers. It would distribute a query among them, have them debate the results, and synthesize a final answer that is more comprehensive and accurate than any single model could produce.

## Kill Switch (Factory Reset)

-   **Status**: Partially Implemented
-   **Purpose**: A last-resort safety mechanism in the event the AI's behavior deviates dangerously from its core principles (a "go full Skynet" scenario).
-   **Behavior**:
    -   **Current Implementation ("Emergency Stop"):** The `mh agent stop-all` command and reverting trust to `observe` acts as a "soft" kill switch, halting all autonomous actions immediately.
    -   **Future Vision:** The ultimate vision for the Kill Switch is a true factory reset. When triggered, it would securely erase all memories, learned preferences, and persona data, effectively reverting the MetaHuman OS to its initial, un-configured state. This is a destructive, irreversible action designed as the ultimate fail-safe.
