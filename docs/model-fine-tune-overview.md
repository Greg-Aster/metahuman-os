
# **MASTER SPECIFICATION DOCUMENT**

### **Cognitive Mode Training Pipeline — Requirements, Behaviors, and Data-Handling Rules**

---

## **0. Overview**

This document defines the full conceptual design, constraints, formatting rules, metadata behavior, and expected output structure for a custom AI training pipeline intended for fine-tuning local models (specifically Qwen, LLaMA-family, Phi, and GPT-J style architectures).

The purpose of the pipeline is to enable three distinct conversational paradigms:

1. **Dual Cognitive Mode** (AI is the “thinker,” user is the “internal monologue”)
2. **Emulation Mode** (standard LLM, user → assistant format)
3. **Agent Mode** (AI as a tool-using or reasoning agent receiving instructions)

The pipeline includes:

* a **Curator** (prepares, cleans, trims data)
* a **Formatter** (applies mode rules)
* a **Schema Manager** (applies model-family-specific wrappers)
* a **Training Exporter** (generates JSONL)

This document **does not define code**, only *what must be true* when the system is finished.

---

# **1. Core Concepts**

### **1.1 Modes fundamentally change how data must be represented**

Each mode instructs the model to behave differently at inference time.
Therefore **each mode MUST produce a different structure of training data.**

Failing to do so will:

* confuse the model
* collapse modes into one behavior
* generate rambling, multi-agent contamination
* degrade fine-tuning stability

Modes exist to enforce *role alignment*.

---

# **2. Data Flow Summary**

A complete pipeline stage flow looks like:

1. **Raw Input Conversation** (any format, messy, multi-turn, rambling)
2. **Metadata Assignment**

   * mode: dual / emulation / agent
   * additional notes if needed
3. **Curator Processing**

   * clean
   * de-verbose
   * shorten outputs
   * enforce rules
4. **Formatter Application** (mode-specific formatting)
5. **Schema Application** (model-family-specific formatting)
6. **Training Export** (single-turn JSONL)

Every training example produced MUST be:

```
{"input": "...", "output": "..."}
```

Or the equivalent JSONL structure dictated by the training tool.

---

# **3. Requirements for Raw Data Curation**

### **3.1 Preserve user input exactly**

The **human-provided content** in any mode must NOT be rewritten or stylistically altered.

Only exceptions:

* profanity filtering (if explicitly requested)
* accidental transcription errors (optional)

### **3.2 Assistant / AI output may be modified**

Assistant responses are allowed to be:

* trimmed
* shortened
* rewritten for clarity
* stripped of boilerplate
* normalized to a consistent style

This is important because assistant verbosity teaches the model to ramble.

### **3.3 Maximum Output Length Enforcement**

Curator MUST enforce limits:

* Default assistant response: **1–3 sentences**
* Occasionally: **long-form responses (5–10%)**
* Very long responses allowed only when they serve a narrative purpose in Emulation Mode

### **3.4 Multi-turn conversations must be broken into single-turn pairs**

Example:

Raw:

```
User: A
Assistant: B
User: C
Assistant: D
```

Becomes:

```
(A → B)
(C → D)
```

Each pair becomes a separate training example unless explicitly tagged multi-turn.

### **3.5 The curator must remove context leakage**

If a later message depends on context that cannot fit into the exported turn, it must either:

* include the missing context
* or be discarded

The model cannot guess missing context.

---

# **4. Mode Definitions**

Each mode includes:

* tags
* purpose
* data inversion rules
* pairing rules
* style rules
* expected format

---

# **5. Dual Cognitive Mode**

### **5.1 Purpose**

Teach the model to simulate being a mind thinking about itself, its world, and its experiences.

### **5.2 Conceptual Rule**

In this mode:

**The user's input is treated as AI’s internal monologue.
The AI’s response is treated as the external world.**

This is the *only* mode where we invert the conversational roles.

### **5.3 Formatting Rules**

The training pair MUST look like:

**input = `<thought>`**
**output = `<world>`**

Example structure:

```
<thought>: {user_text}
<world>: {assistant_text}
```

### **5.4 No rewriting of user thoughts**

Keep the original text.

### **5.5 Assistant text may be shortened**

Trim verbosity. Keep only essential meaning.

---

# **6. Emulation Mode (Standard Chatbot)**

### **6.1 Purpose**

Teach normal conversational behavior.

### **6.2 Rule**

Data follows conventional LLM assistant patterns.

### **6.3 Formatting**

```
<user>: {user_text}
<assistant>: {assistant_text}
```

### **6.4 Style Constraints**

* responses concise unless intentionally long
* preserve natural conversational quality
* avoid meta statements ("As an AI model…")

---

# **7. Agent Mode**

### **7.1 Purpose**

Teach the model to behave like a tool-using agent following instructions and producing actions.

### **7.2 Formatting**

```
<instruction>: {task or query}
<action>: {result, step, output, action}
```

### **7.3 Style Rules**

* deterministic tone
* concise
* structured when appropriate (lists allowed)
* no emotional tone

---

# **8. Schema Manager Requirements**

Different model families require different **wrappers**, **special tokens**, or **section headers**.

The Schema Manager MUST:

1. Choose the correct schema file (Qwen, LLaMA, Phi, etc.)
2. Apply all prefixes, suffixes, and separators
3. Wrap formatted content into the model’s preferred conversational structure

### **Example responsibilities**

* Qwen uses `<|user|>` and `<|assistant|>` tokens
* LLaMA3 uses `[INST] ... [/INST]` formatting
* Phi-3 uses `<|prompt|>` and `<|answer|>`

Schema Manager MUST NOT change the content, only the *wrapping*.

---

# **9. Training Output Requirements**

Output MUST be JSONL.

Example:

```
{"input": "<user> What is the meaning of life?", "output": "<assistant> 42."}
```

Curator must guarantee:

* proper escaping
* no malformed JSON
* no special tokens unless defined in schema
* each record stands alone

---

# **10. Verbosity & Style Enforcement**

### **10.1 Assistant/AI output must default to “brief but informative.”**

Rules:

* 1–3 sentence default
* Occasional long form samples
* Remove filler such as:

  * “As an AI language model…”
  * “I’m just here to help…”
  * “Certainly! Here’s…”
* Avoid over-politeness or corporate tone

### **10.2 User input must be kept raw**

Do not:

* summarize
* shorten
* rewrite

User data teaches *personality*, *linguistic style*, and *problem patterns*.

---

# **11. Multi-Turn Conversations**

### **11.1 Default behavior: split into independent pairs**

Unless metadata specifies “multi-turn”, break conversations into single pairs.

### **11.2 Multi-turn examples must be standalone**

If a multi-turn block is preserved, it must:

* include all necessary context inside the block
* not reference earlier data
* not exceed token limits

---

# **12. Avoiding Mode Contamination**

The curator MUST prevent mixing mode types.
Therefore:

* Dual mode examples must ONLY contain `<thought>` → `<world>`
* Emulation mode must ONLY contain `<user>` → `<assistant>`
* Agent mode must ONLY contain `<instruction>` → `<action>`

If mixed content exists, curator must:

* separate examples
* or discard ambiguous cases

---

# **13. Continuous Fine-Tuning Considerations**

### **13.1 LoRA merging should be avoided for incremental long-term training**

This system is intended for:

* full fine-tuning
* iterative improvement
* repeated training epochs

### **13.2 All training cycles require clean, consistently formatted data**

Even one malformed example can:

* distort style
* introduce rambling
* collapse modes

---

# **14. Metadata Requirements**

Each raw conversation MUST include a mode tag:

```
mode: dual
mode: emulation
mode: agent
```

Optional metadata:

* “multi_turn: true”
* “long_output: allowed”
* “priority: high”
* “discard: true” (for debugging)

Curator must use metadata to determine:

* which formatter to apply
* which schema to apply
* which trimming rules to use

---

# **15. The System Must Not Hard-Code Behaviors**

Because:

* users may create their own models
* modes may be extended
* future architectures may need new schemas

Therefore:

* everything must be defined in metadata
* nothing should use hardcoded assumptions
* formatting is data-driven

---

# **16. Summary of the Most Critical Rules**

### **16.1 Role inversion only happens in Dual Mode**

User text = thought
Assistant text = world

### **16.2 Responses must be short by default**

Models learn verbosity directly from the training set.

### **16.3 Conversations must be split into single-turn pairs**

Unless explicitly marked multi-turn.

### **16.4 Schema-driven formatting is mandatory**

Model families have incompatible tokenization conventions.

### **16.5 Assistant output may be trimmed, user input may not**

User input teaches the model its “other voice.”

### **16.6 Do not mix modes**

Each mode is separate and must maintain its own structure.

---

# **17. Final Statement**

This document defines **everything the coding agents need to understand**, including:

* goals
* constraints
* behaviors
* formatting rules
* metadata conventions
* mode differences
* schema requirements
* output structure
* training expectations
* stability considerations

No specific implementation approach is required.
Agents may choose any reasonable coding strategy as long as **all requirements in this document are satisfied exactly**.

-
