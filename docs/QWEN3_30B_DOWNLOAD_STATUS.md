# Qwen3-30B-A3B Model Download

**Started:** October 28, 2025
**Status:** 🔄 In Progress
**Purpose:** Enable GGUF conversion for 30B LoRA adapters

---

## Download Details

- **Model**: unsloth/qwen3-30b-a3b
- **Size**: ~60GB
- **Location**: `/home/greggles/metahuman/vendor/models/qwen3-30b-a3b`
- **Method**: HuggingFace Hub snapshot_download
- **Resumable**: Yes (if interrupted, just run the script again)

---

## Progress

**Current Status:** 5GB / 60GB (~8%)

To check progress at any time:
```bash
./temp_monitor_download.sh
```

To check detailed output:
```bash
# The download is running in background shell 6569d0
# It will continue even if this session ends
```

---

## What Happens After Download

Once the download completes (~1-2 hours), we'll:

1. **Convert the 2025-10-28 adapter to GGUF**
   ```bash
   pnpm tsx brain/agents/gguf-converter.ts 2025-10-28
   ```

2. **Create Ollama Modelfile**
   - Points to your local qwen3:30b base model
   - Adds the new LoRA adapter

3. **Load into Ollama**
   ```bash
   ollama create greg-2025-10-28 -f out/adapters/2025-10-28/Modelfile
   ```

4. **Update active adapter**
   - Modify `persona/overrides/active-adapter.json`
   - Set `modelName: "greg-2025-10-28"`
   - Set `status: "loaded"`

5. **Test it**
   ```bash
   ./bin/mh chat
   # Should now use the new 30B adapter!
   ```

---

## Why We Need This

**The Problem:**
- Your 30B adapter was trained remotely (successfully!)
- It's in safetensors format (1.6GB)
- To use with Ollama, needs to be converted to GGUF
- llama.cpp's converter needs the original model files

**The Solution:**
- Download full model once (60GB, one-time)
- Keep it in `vendor/models/` for future conversions
- Use it as reference for all future 30B adapter conversions
- Never needs to be loaded/run - just used as a blueprint

---

## Future Benefits

Once you have the base model, future 30B adapter conversions will be:
1. Train on RunPod (~40 min, $0.55)
2. Download adapter (2.4GB)
3. Convert to GGUF (1 minute, local)
4. Load into Ollama (instant)
5. Ready to use!

No more waiting for 60GB downloads - this is a one-time investment.

---

## Disk Space Usage

```
vendor/models/qwen3-30b-a3b/     ~60GB  (base model, permanent)
out/adapters/2025-10-28/         ~2.4GB (adapter safetensors)
out/adapters/2025-10-28/         ~160MB (adapter GGUF, after conversion)
```

Total: ~62.5GB for 30B training capability

Compare to downloading the base model every time: Would need 60GB free space temporarily for each conversion.

---

## Monitoring

**Check download progress:**
```bash
./temp_monitor_download.sh
```

**Expected output:**
```
Checking download progress...

Downloaded so far: 5.0G
Files downloaded: 41

Target: ~60GB, 26 files
```

**Download speed:** Depends on your connection (typically 10-50 MB/s)
**Time remaining:** ~1-2 hours from start

---

## If Download Gets Interrupted

No problem! The download is resumable. Just run:
```bash
./venv/bin/python3 /tmp/download_qwen3.py
```

It will resume from where it left off.

---

## Next Steps

I'll check back on the download progress. Once it completes, I'll:
1. ✅ Verify all files downloaded correctly
2. ✅ Run the GGUF conversion
3. ✅ Create the Ollama model
4. ✅ Test it with chat

You can continue working on other things - this will run in the background!
