# MetaHuman OS - Morning Status & Next Steps

This document summarizes the debugging session from Oct 30, 2025, and outlines the plan for completing the model training cycle.

---

## Summary of Investigation

We successfully diagnosed a complex issue preventing the `Qwen3-Coder-30B` model from being converted to the required GGUF format.

1.  **Initial Problem:** The `full-cycle.ts` script was failing after the training step. The GGUF conversion was not working for Qwen models, whereas it had previously worked for a `gpt-oss` model.

2.  **Root Cause:** The `unsloth` library's built-in converter does not support the `Qwen3-Coder-30B` architecture. We then discovered that the standard `llama.cpp` converter *does* support it, but our attempts were failing with a `ValueError: Mismatch between weight map and model parts`. We traced this back to the output directory (`out/adapters/2025-10-30/merged_gguf_output/`) containing a mix of safetensor files from both the failed Qwen run and a previous successful `gpt-oss` run. This confused the converter.

3.  **Solution:**
    *   We cleaned the `merged_gguf_output` directory by removing the old `gpt-oss` model files.
    *   We manually initiated the GGUF conversion using the standard `llama.cpp` script on the clean set of `Qwen3-Coder-30B` safetensor files.

## Current Status (as of end-of-day Oct 30)

*   **Conversion in Progress:** A background process is **actively and successfully** converting the trained and merged `Qwen3-Coder-30B` model to GGUF format.
*   **Output File:** The final model is being written to:
    ```
    /home/greggles/metahuman/out/adapters/2025-10-30/qwen3-coder-30b-merged.gguf
    ```

---

## Your Next Steps in the Morning

1.  **Check Conversion Status:**
    The conversion process was still running when we left off. First, check if it has completed. You can check the file size. A completed 30B model in `bf16` format should be around **30 GB**.
    ```bash
    ls -lh /home/greggles/metahuman/out/adapters/2025-10-30/qwen3-coder-30b-merged.gguf
    ```

2.  **Load the Model into Ollama:**
    Once the file is fully created, you can load it into Ollama. 
    *   **Create a Modelfile:** Create a new file named `qwen3-coder-30b.modelfile` with the following content:
        ```
        FROM /home/greggles/metahuman/out/adapters/2025-10-30/qwen3-coder-30b-merged.gguf
        ```
    *   **Run `ollama create`:**
        ```bash
        ollama create qwen3-coder-30b-trained -f ./qwen3-coder-30b.modelfile
        ```

3.  **Update `agent.json`:**
    After the model is in Ollama, you can make it the default model for your agent by editing `/home/greggles/metahuman/etc/agent.json` and setting the `model` field:
    ```json
    {
      "model": "qwen3-coder-30b-trained:latest"
    }
    ```

4.  **Future-Proof the Automated Script:**
    The manual cleanup we did is not a permanent solution. To prevent this issue in the future, the `full-cycle.ts` or `lora-trainer.ts` script should be modified to **clean the `merged_gguf_output` directory** before the training process begins. This will ensure that each run starts with a clean slate, preventing file conflicts.
