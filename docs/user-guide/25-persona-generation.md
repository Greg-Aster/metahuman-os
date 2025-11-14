# Persona Generation System

The Persona Generation System is a guided, interactive interview process that helps you create a high-fidelity persona profile for your MetaHuman OS. By answering a series of questions, you can provide the system with the information it needs to generate a detailed and accurate representation of your personality, values, and goals.

## How It Works

The system uses a specialized "psychotherapist" language model to conduct the interview. This model is trained in motivational interviewing techniques to ask open-ended, non-judgmental questions that help you explore and articulate different aspects of your personality.

The interview process is divided into several categories, including:

*   **Values**: What core principles guide your life?
*   **Goals**: What are you trying to achieve, both in the short and long term?
*   **Style**: How do you communicate and interact with others?
*   **Biography**: What are the key experiences that have shaped who you are?
*   **Current Focus**: What are you currently working on or thinking about?

As you answer the questions, the system analyzes your responses and builds a "persona draft". This draft is a structured representation of your personality that can be used to update your `persona/core.json` file.

## The Interview Process

1.  **Start the Interview**: You can start a new persona generation interview from the "System" -> "Persona" tab in the web UI.
2.  **Answer the Questions**: The system will ask you a series of questions, one at a time. You can answer them in as much or as little detail as you like.
3.  **Track Your Progress**: A progress meter will show you how much of each category you have completed.
4.  **Pause and Resume**: You can pause the interview at any time and resume it later.
5.  **Review and Apply**: Once the interview is complete, you can review the persona draft and a diff of the changes that will be made to your profile. You can then choose to "apply" the changes, "merge" them with your existing persona, or "discard" them.

## UI and UX

The persona generation utility is integrated into the "System" -> "Persona" tab in the web UI. It features a chat-style interface with a conversation log, a progress meter, and controls for pausing, resuming, and discarding sessions.

When the interview is complete, a review dialog allows you to see the full transcript, a side-by-side diff of the proposed changes, and a merge strategy selector.

## Persona Persistence and Training Hooks

*   **Session Storage**: Each interview session is stored in `profiles/<user>/persona/interviews/`.
*   **Persona Drafts**: The persona draft generated from the interview is stored in the session file.
*   **Training Data**: Finalized transcripts are copied to `profiles/<user>/memory/training/persona/` to be used for future LoRA adapter training.

## Benefits

*   **Guided Process**: The interview process guides you through the process of articulating your personality, making it easier to create a detailed and accurate profile.
*   **High-Fidelity Personas**: The use of a specialized language model results in a more nuanced and accurate representation of your personality.
*   **User Control**: You are always in control of the process. You can review and approve all changes before they are applied.

## Future Enhancements

*   **CLI Integration**: The ability to start, resume, and manage persona generation sessions from the command line.
*   **Batch Interview Mode**: The ability to import pre-written answers to the interview questions.
*   **Auto-Resume on Login**: The system will notify you if you have an incomplete session and allow you to resume it.
