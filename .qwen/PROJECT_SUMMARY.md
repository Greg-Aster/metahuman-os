# Project Summary

## Overall Goal
Enhance the MetaHuman OS web interface and infrastructure to enable proper file operations through the skills system, improve LoRA training capabilities with alternative frameworks, and add comprehensive UI controls for voice and model configuration.

## Key Knowledge
- MetaHuman OS uses a skills-based architecture with trust levels (observe, suggest, supervised_auto, bounded_auto)
- File operations are handled through `fs_write` and `fs_read` skills with security validation and path restrictions
- The system has two AI interfaces: persona chat (conversational) and operator agent (skills-based)
- Skills require specific trust levels and path validation (only allowed in memory/, out/, logs/, etc.)
- LoRA training is configured in `etc/agent.json` (base model) and `etc/model_map.json` (mapping to Hugging Face IDs)
- The chat UI has two modes: conversation and inner dialogue, with separate voice controls
- Qwen 30B model maps to `Qwen/Qwen1.5-32B-Chat` in the model map configuration
- Unsloth is a preferred alternative to Axolotl for training large models more efficiently
- The audio organizer agent was changed from 15-second to 15-minute polling interval
- Central configuration for base model is now in `etc/agent.json` with fallback to this file across all components

## Recent Actions
- Fixed file operations not working through the web UI by enhancing the operator routing system
- Added file operation detection in the chat interface to automatically route to the skills system
- Updated the audio organizer to run every 15 minutes instead of 15 seconds to reduce audit log spam
- Changed base model from qwen3:8b to qwen3:30b in etc/agent.json and updated all references
- Implemented model selection and dual mode controls in the adaptation tab with Ollama model fetching
- Added inner dialog voice toggle for the boredom service in the inner dialog tab
- Fixed the lora-trainer to read from etc/agent.json and etc/model_map.json instead of hardcoding models
- Updated config.yaml generation to use correct base model, output_dir, model_type, tokenizer_type, and flash_attention
- Added unsloth training capability as an alternative to Axolotl for better performance with large models

## Current Plan
1. [DONE] Understand MetaHuman OS architecture and components
2. [DONE] Check system initialization status and trust levels
3. [DONE] Explore available agents and their functions
4. [DONE] Verify Ollama AI model connectivity
5. [DONE] Test memory search functionality
6. [DONE] Check current trust level and agent operations
7. [DONE] Summarize system capabilities and suggest next actions
8. [DONE] Investigate why file operations weren't working through the UI
9. [DONE] Test if the operator agent can perform file operations
10. [DONE] Provide complete explanation and solution
11. [DONE] Enhance the Web UI to detect file operations and route them to the operator agent
12. [DONE] Implement proper file operation detection in chat interface
13. [DONE] Add visual feedback for file operations (success/failure indicators)
14. [DONE] Add file listing, deletion, and other operations support
15. [DONE] Update audio organizer polling interval from 15s to 15m
16. [DONE] Change base model from qwen3:8b to qwen3:30b
17. [DONE] Implement central model configuration in etc/agent.json
18. [DONE] Add model selection and dual mode controls in adaptation tab
19. [DONE] Add inner dialog voice toggle in inner dialog mode
20. [DONE] Fix lora-trainer to use correct model mappings and output paths
21. [DONE] Add unsloth as alternative training framework for better large model support

---

## Summary Metadata
**Update time**: 2025-10-25T03:01:34.789Z 
