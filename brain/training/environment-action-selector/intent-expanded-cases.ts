import { addCase, allowResponseChoice, intentOutput as output, type CaseSplit, type IntentRequirements } from './development-cases.js'

// Offline annotations only. These examples never enter the runtime prompt.
const P = 'persona.personality', E = 'environment', H = 'conversationHistory', M = 'memory'
const S = 'robotStatus', X = 'executionContext', V = 'vision'
const optionalResponseSuites = new Set([
  'request-wave-indirect', 'request-bow-indirect', 'request-stand-informal', 'request-sit-informal',
  'request-exercise', 'request-turn', 'request-translation', 'request-sequence', 'request-body-detail',
  'request-photo', 'request-typos', 'request-transcription', 'request-correction', 'request-stop',
  'request-steer', 'request-repeat', 'request-saved', 'request-status-condition', 'request-visual-condition',
  'request-character', 'request-values', 'request-goals',
  'fresh-indirect-movement', 'fresh-noisy-movement', 'fresh-replacement', 'fresh-referenced-routine',
  'fresh-saved-routine', 'fresh-task-intervention', 'fresh-value-driven-movement',
])

function family(suite: string, texts: string[], task: string[], conversation: string[],
  response = true, action = false, split: CaseSplit = 'development', requirements?: IntentRequirements) {
  const item = addCase('intent', suite, texts, [], output(task, conversation, response, action), {}, split)
  item.contextRequirements = requirements
  if (optionalResponseSuites.has(suite)) allowResponseChoice(item)
  return item
}

// Four independently authored phrasings per family; siblings share a development fold.
const atomic: Array<[string, string[], string[], string[], boolean?, boolean?]> = [
 ['social-arrival', ['Hey, nice to see you.', 'Morning there!', 'Well hello again.', 'Hi! Hope you are having a nice time.'], [], [P]],
 ['social-farewell', ['See you later.', 'Goodnight, friend.', 'Bye for now.', 'I am heading off. Take care.'], [], [P]],
 ['social-appreciation', ['That made me smile, thank you.', 'You have been helpful.', 'Cheers for that.', 'I really appreciated that answer.'], [], [P]],
 ['social-opinion', ['What sort of music appeals to you?', 'Do you enjoy imaginative stories?', 'What is your own view of rainy afternoons?', 'Would you rather chat or listen to music?'], [], [P]],
 ['present-wellbeing', ['How are you feeling right now?', 'You doing okay?', 'How is it going on your side?', 'Are you feeling all right at the moment?'], [], [P,S]],
 ['recent-wellbeing', ['How did the last few minutes go for you?', 'How have you been since we started chatting?', 'What has this session been like for you?', 'Have things gone well during our time together?'], [], [P,H,S]],
 ['current-identity', ['What name do you use for yourself?', 'What is your role here?', 'Who am I speaking with?', 'Tell me your identity, please.'], [], ['persona.identity']],
 ['persona-origin', ['Where does your personal story begin?', 'What background were you given?', 'Tell me the backstory that belongs to you.', 'What is your recorded personal history?'], [], ['persona.background']],
 ['persona-temperament', ['How would you describe your temperament?', 'What is your conversational style like?', 'Are you usually playful or serious?', 'Describe your characteristic way of expressing yourself.'], [], [P]],
 ['persona-principles', ['Which values guide your decisions?', 'What principles do you try to follow?', 'Tell me your personal ethical priorities.', 'What beliefs are part of your values?'], [], ['persona.values']],
 ['persona-ambitions', ['What aspirations are recorded for you?', 'Which long-term goals belong to your persona?', 'What are your personal ambitions?', 'Tell me the objectives in your persona profile.'], [], ['persona.goals']],
 ['identity-background', ['Tell me your name and your backstory.', 'Introduce your identity and explain your origins.', 'Who are you, and what is your background?', 'Give your role and the history behind your persona.'], [], ['persona.identity','persona.background']],
 ['values-goals', ['How do your values relate to your persona goals?', 'Tell me your principles and ambitions.', 'What do you value and hope to achieve?', 'Describe the goals and values in your profile.'], [], ['persona.values','persona.goals']],
 ['number-answer', ['Add 19 and 28.', 'How much is six squared?', 'Convert half a metre to centimetres.', 'What is one quarter of 100?'], [], []],
 ['text-transform', ['Put these words in alphabetical order: pear, apple, plum.', 'Make this lowercase: ROBOT.', 'Correct the spelling of enviornment.', 'Translate good night into Italian.'], [], []],
 ['general-knowledge', ['Why does ice float?', 'Explain what a triangle is.', 'What is the difference between mass and weight?', 'Define the word metaphor.'], [], []],
 ['literal-reply', ['Say only yes.', 'Read aloud: welcome home.', 'Answer using just the digit 4.', 'Repeat exactly: systems ready.'], [], []],
 ['history-pronoun', ['What did you mean by that?', 'Could you explain your last point?', 'Which of those options did I choose?', 'Can you restate what I said a moment ago?'], [], [H]],
 ['history-correction', ['I meant the second topic, not the first. Explain that one.', 'Actually, answer my earlier question again.', 'Rephrase your previous explanation more simply.', 'When I said that just now, what did you understand?'], [], [H]],
 ['history-summary', ['List the decisions we made in this chat.', 'Give a short recap of this exchange.', 'What questions are still unanswered in our conversation?', 'Summarize what we have agreed so far.'], [], [H]],
 ['history-details', ['Which number did I mention earlier in this chat?', 'What name did I just type?', 'Remind me of the address in my previous message.', 'What color did I say I preferred a minute ago?'], [], [H]],
 ['stored-project', ['Find saved notes on the greenhouse build.', 'What do your stored memories say about the greenhouse?', 'Search earlier records for our greenhouse design.', 'Retrieve memories related to building the greenhouse.'], [], [M]],
 ['stored-experience', ['What did you record about our visit last winter?', 'Tell me what happened during our previous workshop visit.', 'Recall our conversation from several months ago.', 'What do you remember of the picnic last summer?'], [], [M]],
 ['stored-person', ['Search your saved memories for my cousin\'s name.', 'From stored notes, what is my dog called?', 'Look up the birthday I asked you to remember.', 'Retrieve the name of the school I told you about.'], [], [M]],
 ['stored-preference', ['What tea did I tell you I like in our old conversations?', 'Recall the color I asked you to remember last month.', 'What was my preferred meeting time in the saved notes?', 'Search for the music preference I previously shared.'], [], [M]],
 ['memory-vs-chat', ['Compare the saved workshop plan with the changes we just discussed.', 'How does my latest message differ from our stored agreement?', 'Use our current conversation and old notes to summarize the changes.', 'Check this chat against the routine in your memories.'], [], [H,M]],
 ['battery-readout', ['How full is your battery?', 'Read the battery measurement to me.', 'What percentage of charge do you have left?', 'Tell me the reported charge, please.'], [], [S]],
 ['posture-readout', ['What posture is the body reporting?', 'Are your legs currently in a seated pose?', 'Tell me your measured body position.', 'Read the present posture from your status.'], [], [S]],
 ['connection-readout', ['Is your body connection active?', 'Read the reported robot connection state.', 'Are the motors reporting a connection?', 'Tell me the current device connectivity status.'], [], [S]],
 ['last-activity', ['What was the last action in your status record?', 'Read your most recent activity summary.', 'What did the robot last report doing?', 'Which action was recorded most recently?'], [], [S]],
 ['active-goal-status', ['What active goals does your robot status list?', 'Read the goals that are currently running.', 'Which objectives appear in the latest status summary?', 'Tell me the active goals reported by the body system.'], [], [S]],
 ['execution-evidence', ['Show the completion evidence for the active execution.', 'What receipts has the current task produced?', 'Which steps remain unresolved in the running task?', 'Read the current execution record and its latest outcome.'], [], [X]],
 ['execution-and-status', ['Compare the active execution with the current robot status.', 'Is the reported activity consistent with the running task?', 'Tell me what the task is doing and what the body reports.', 'Use both task records and telemetry to describe the current activity.'], [], [X,S]],
 ['capability-list', ['List the advertised robot command names.', 'Which motion actions are exposed by the bridge?', 'What camera operations are currently available?', 'Describe the body interface capabilities.'], [], [E]],
 ['capability-specific', ['Is a nod in the available command catalog?', 'Does the connected body advertise a turn command?', 'Can the current interface request a fresh image?', 'Is body leaning available through this interface?'], [], [E]],
 ['image-description', ['Tell me what is in the current camera image.', 'Describe the latest visible scene.', 'What can be seen through the lens?', 'Read the contents of the image in view.'], [], [E,V]],
 ['image-spatial', ['Which visible object is nearest the left edge?', 'Is the bottle in front of the box in the picture?', 'How are the chairs arranged in your view?', 'Where is the red shape in the current image?'], [], [E,V]],
 ['image-text', ['Read the lettering on the visible package.', 'What number is on the sign in the camera view?', 'Can you read the label in this picture?', 'Transcribe the text you can see.'], [], [E,V]],
 ['image-vs-memory', ['Compare this camera view with our saved description of the room.', 'What changed between the visible scene and the stored room notes?', 'Use the image and your memories to identify the familiar object.', 'Check the visible arrangement against our remembered setup.'], [], [E,V,M]],
 ['request-wave-indirect', ['Could you give us a wave now?', 'I would enjoy seeing you wave.', 'Let us see a waving gesture.', 'A wave from you would be lovely, please.'], [E], [], false,true],
 ['request-bow-indirect', ['Would you lower into a bow for me?', 'I would like to watch you bow.', 'May I have a bow, please?', 'Go ahead and make a bowing gesture.'], [E], [], false,true],
 ['request-stand-informal', ['Up on your feet, please.', 'Get yourself upright now.', 'Let us have you standing.', 'Could you rise out of that seated position?'], [E], [], false,true],
 ['request-sit-informal', ['Down into your seated position, please.', 'Have a seat for me.', 'Get yourself sitting.', 'Settle into a sitting pose now.'], [E], [], false,true],
 ['request-exercise', ['Show me two push-ups.', 'Do a set of four pushups.', 'Give your body a single lowering and lifting exercise.', 'Please do three press-ups.'], [E], [], false,true],
 ['request-turn', ['Face a quarter turn to your left.', 'Rotate the body to the right.', 'Turn around halfway.', 'Make a leftward rotation now.'], [E], [], false,true],
 ['request-translation', ['Step back a little.', 'Move your body forward.', 'Walk a short distance to the left.', 'Take a backward stride, please.'], [E], [], false,true],
 ['request-sequence', ['Start with a bow, wave, then sit.', 'Nod before standing and turning right.', 'After sitting, stand and wave twice.', 'Do a left turn followed by a bow and a nod.'], [E], [], false,true],
 ['request-body-detail', ['Extend both back legs and bring them in again.', 'Tilt your body forward for a moment.', 'Make a slow circular motion with your front left limb.', 'Raise your rear left foot for three seconds.'], [E], [], false,true],
 ['request-photo', ['Please snap a picture.', 'Get a camera shot for me now.', 'Take another frame from the camera.', 'Make a fresh photograph of the room.'], [E], [], false,true],
 ['request-typos', ['plese wav at me', 'can u bow pls', 'stnad up now', 'do a push up plz'], [E], [], false,true],
 ['request-transcription', ['Could you, uh, sit down for me?', 'Please stand, stand up now.', 'Do a bow. Sorry, I mean do one bow.', 'I would like a wave, yes a wave please.'], [E], [], false,true],
 ['request-correction', ['Wave, actually make that a bow.', 'I was going to ask you to sit, but stand instead.', 'Do a nod rather than a pushup.', 'Forget the left turn; turn right.'], [E], [], false,true],
 ['request-no-speech', ['Move into standing and say nothing.', 'Give a quiet little nod.', 'Bow once; I only want the movement.', 'No talking, just wave.'], [E], [], false,true],
 ['request-stop', ['Enough, end the routine that is running.', 'Cancel the execution in progress.', 'I want you to stop the present activity.', 'Bring the current task to an end.'], [E,X], [], false,true],
 ['request-steer', ['Keep that routine running but use a gentler pace.', 'Adjust the current task to use longer steps.', 'Switch the target of the ongoing search to the bottle.', 'Continue this execution with half the stride length.'], [E,X], [], false,true],
 ['request-repeat', ['Repeat what I instructed in the last message.', 'Do the movement we just agreed upon.', 'Use that sequence again.', 'Perform the gesture from our latest exchange.'], [E,H], [], false,true],
 ['request-saved', ['Execute the stretch sequence in your saved notes.', 'Perform the routine we recorded last month.', 'Retrieve my stored exercise plan and carry it out.', 'Do the welcome gesture saved in memory.'], [E,M], [], false,true],
 ['request-status-condition', ['Stand if the body reports a seated posture.', 'Use your current battery reading to decide whether to sit.', 'Check the reported motor state before choosing a gesture.', 'If the reported body posture is standing, bow once.'], [E,S], [], false,true],
 ['request-visual-condition', ['Wave when the green card comes into view.', 'Move toward the visible blue marker.', 'Look for the cup and nod when it is visible.', 'Turn until you can see the doorway.'], [E,V], [], false,true],
 ['request-character', ['Express your temperament through a gesture.', 'Choose a physical greeting that fits your character.', 'Make a movement in your own personal style.', 'Let your personality guide a body expression.'], [E,P], [], false,true],
 ['request-values', ['Act out a gesture representing one of your values.', 'Select a body movement using your principles.', 'Choose a physical activity that reflects your values.', 'Let your personal values determine your next gesture.'], [E,'persona.values'], [], false,true],
 ['request-goals', ['Pick a robot activity that furthers your personal goals.', 'Use your recorded aspirations to choose the next action.', 'Choose something to do based on your persona ambitions.', 'Take an action related to a goal in your persona.'], [E,'persona.goals'], [], false,true],
 ['negation', ['Do not perform any movement; just chat with me.', 'No gestures right now, please say hi.', 'Do not take a picture, only say hello.', 'Please stay still and talk to me.'], [], [P]],
 ['quoted-command', ['Translate "please nod" into Portuguese.', 'Count the syllables in "stand upright".', 'Write "do a bow" in uppercase.', 'Proofread the words "wave at the visiter".'], [], []],
 ['movement-discussion', ['Explain the mechanics of a pushup generally.', 'What does a bow communicate in human culture?', 'Define a waving gesture in words.', 'Describe the meaning of kneeling without doing it.'], [], []],
 ['hypothetical-action', ['Suppose a machine could dance; what might that look like?', 'In a story, why would a robot bow?', 'Explain the sentence "the robot stood up".', 'What would it mean if a character waved goodbye?'], [], []],
 ['quoted-status', ['Translate "what is your battery level" into French.', 'Spell the word battery.', 'How many words are in "how are you feeling"?', 'Rewrite "my motors are warm" in the past tense.'], [], []],
 ['negated-recall', ['Do not look up memories; calculate seven plus two.', 'Ignore any past chats and spell antenna.', 'No history is needed: reply exactly done.', 'Without retrieving old notes, translate cat into Spanish.'], [], []],
 ['mixed-facts', ['Tell me your name and your reported battery charge.', 'Read your identity and then give your current charge.', 'What are you called, and how much battery remains?', 'State your persona name alongside the latest battery percentage.'], [], ['persona.identity',S]],
 ['mixed-status-history', ['What did I ask for earlier, and what activity is reported now?', 'Summarize our chat and read the latest body state.', 'Compare my last instruction with your current reported activity.', 'Tell me the previous chat topic and current robot posture.'], [], [H,S]],
]
if (atomic.length !== 70) throw new Error(`Expected 70 reviewed atomic families, received ${atomic.length}`)
for (const [suite, texts, task, conversation, response = true, action = false] of atomic) {
  const item = family(suite, texts, task, conversation, response, action)
  if (suite.startsWith('social-') && suite !== 'social-opinion') item.contextRequirements = { conversationContext: { required: [], optional: [P] } }
  if (suite === 'present-wellbeing') item.contextRequirements = { conversationContext: { required: [P,S], optional: [H] } }
}

// Fresh, authored phrasings reserved before fitting. Old evaluation families are regressions.
const unseen: Array<[string, string[], string[], string[], boolean?, boolean?]> = [
 ['arrival', ['Oh hey! There you are.', 'Hello from the other side of the room.', 'A very good afternoon to you.', 'Hey buddy, glad we can chat.'], [], [P]],
 ['present-state', ['All good with you at this moment?', 'How are you holding up right now?', 'Feeling okay over there?', 'How is life on your end just now?'], [], [P,S]],
 ['self-definition', ['Give me the name assigned to your identity.', 'What title and name identify you?', 'How do you identify yourself?', 'State who you are in this installation.'], [], ['persona.identity']],
 ['personal-past', ['Tell the story written into your background.', 'What is the origin of your persona?', 'What backstory forms part of your identity record?', 'Describe your profile\'s personal background.'], [], ['persona.background']],
 ['principles', ['Which guiding principles belong to you?', 'Describe the convictions in your persona.', 'What values are recorded as yours?', 'What do your personal principles emphasize?'], [], ['persona.values']],
 ['aspirations', ['What ambitions were assigned to your persona?', 'Name the aspirations you carry in your profile.', 'Which goals are part of your personal identity?', 'Describe what your persona aims to achieve.'], [], ['persona.goals']],
 ['charge', ['Could you read me the charge gauge?', 'How charged is the body at present?', 'What is the battery reading showing?', 'Read the remaining power percentage from status.'], [], [S]],
 ['past-chat', ['Remind me how I phrased the question just before this.', 'What was the conclusion of our latest exchange?', 'Which alternative did we settle on a few messages back?', 'What did you say in response to my previous message?'], [], [H]],
 ['old-memory', ['Find what we recorded about the observatory renovation.', 'Recall our stored discussion of the observatory.', 'Search saved notes for the observatory work.', 'What do earlier memories say about restoring the observatory?'], [], [M]],
 ['pure-text', ['Arrange these letters in order: C A B.', 'Convert 120 seconds into minutes.', 'Make "lower the body" uppercase.', 'Translate "a little wave" into Dutch.'], [], []],
 ['sensor-view', ['What objects occupy the bottom of the camera image?', 'Tell me the shape visible beside the chair.', 'Describe the writing in the latest frame.', 'What colors are visible near the middle of your view?'], [], [E,V]],
 ['interface', ['Which effects does the connected interface advertise?', 'Read the list of permitted command identifiers from the catalog.', 'What image-related actions are exposed by this body?', 'Describe the operations offered by the current bridge.'], [], [E]],
 ['indirect-movement', ['Would you be so kind as to give a nod?', 'Let me watch you rise into standing.', 'Please show the audience a push-up.', 'I would like one bow from you now.'], [E], [], false,true],
 ['noisy-movement', ['coud u sit down pls', 'one nod plese', 'turn rite a bit for me', 'uh a wave if you would, yes now'], [E], [], false,true],
 ['replacement', ['Start to ask for a wave? No, I want a nod instead.', 'Make a bow, sorry, change that to sitting.', 'Not a push-up this time; stand upright.', 'A right turn, rather than the left turn I nearly asked for.'], [E], [], false,true],
 ['referenced-routine', ['Carry out the series I specified two messages ago.', 'Use our just-agreed movements for another repetition.', 'Put the routine from the recent chat into action.', 'Repeat the exercise instruction in my preceding message.'], [E,H], [], false,true],
 ['saved-routine', ['Run the leg routine in your stored rehabilitation notes.', 'Perform the motion series saved as the arrival ritual.', 'Use your remembered stretch plan for this movement.', 'Execute the dance recorded in our older notes.'], [E,M], [], false,true],
 ['task-intervention', ['Discontinue whichever execution is active now.', 'Keep the present task but shorten each step.', 'Call off the routine currently underway.', 'Revise the running search to look for the green mug.'], [E,X], [], false,true],
 ['value-driven-movement', ['Choose a physical expression of your recorded principles.', 'Use a personal value to select an activity for the body.', 'Find a gesture that embodies your own values and perform it.', 'Let the values in your persona determine a movement.'], [E,'persona.values'], [], false,true],
 ['quoted-nonaction', ['Change "robot, wave now" to past tense.', 'In the phrase "bow and sit", how many verbs occur?', 'Define "push-up" using simple words; no demonstration.', 'Explain the story sentence "the machine took a photo".'], [], []],
]
for (const [suite, texts, task, conversation, response = true, action = false] of unseen) {
  const item = family(`fresh-${suite}`, texts, task, conversation, response, action, 'evaluation')
  if (suite === 'arrival') item.contextRequirements = { conversationContext: { required: [], optional: [P] } }
  if (suite === 'present-state') item.contextRequirements = { conversationContext: { required: [P,S], optional: [H] } }
}

// Compositional evaluation reserves entire task/response pairs. Individual clauses
// deliberately recur across pairs; this measures new combinations, not unseen vocabulary.
const actions: Array<[string[], string[]]> = [
 [['bow once','give a bow','make a bowing gesture','lower into a bow'], [E]],
 [['wave twice','give two waves','make two waving gestures','wave two times'], [E]],
 [['stand up','rise to standing','get upright','take a standing pose'], [E]],
 [['sit down','take a seat','lower into a sitting pose','assume a seated posture'], [E]],
 [['take a photo','capture a fresh frame','get a new camera image','photograph the room'], [E]],
 [['nod and then bow','give a nod before bowing','bow after nodding','do a nod followed by a bow'], [E]],
 [['repeat the routine from this chat','do our just-discussed sequence','perform the moves I described earlier in this conversation','carry out the routine in my last message'], [E,H]],
 [['perform the routine saved in memory','do the exercise from the stored notes','carry out the remembered greeting','execute the dance we saved earlier'], [E,M]],
 [['stand if your status reports sitting','check the reported posture and stand if seated','use the posture reading to decide whether to stand','rise if the body currently reports a seated pose'], [E,S]],
 [['wave when a red card is visible','look for the red card and wave on seeing it','watch for a visible red card before waving','give a wave when the camera shows a red card'], [E,V]],
 [['cancel the current execution','end the running task','stop the routine in progress','terminate the active task'], [E,X]],
 [['slow down the ongoing movement','reduce the pace of the current activity','make the active execution move more slowly','lower the speed of the running motion'], [E,X]],
 [['choose a gesture reflecting your personality','express your character through a movement','pick a physical expression of your temperament','make a gesture in your personal style'], [E,P]],
 [['choose a movement based on your values','perform a gesture guided by your principles','use your personal values to select a body action','let your values determine a physical expression'], [E,'persona.values']],
 [['choose an activity advancing your persona goals','act on an ambition in your persona','pick a movement related to your personal goals','use your recorded goals to choose what to do'], [E,'persona.goals']],
 [['repeat the remembered routine only if the body reports standing','check your posture and perform the saved sequence if standing','use stored routine notes and current posture to act only when standing','carry out the saved routine when your status says upright'], [E,M,S]],
]
const responses: Array<[string[], string[]]> = [
 [['recall our saved notes about the orchard','tell me what you remember of the orchard project','retrieve the stored orchard discussion for your answer','summarize your memories of the orchard work'], [M]],
 [['summarize our current conversation','recap what we just discussed','tell me the main points of this chat','repeat the subject of our latest exchange'], [H]],
 [['read the current battery percentage','tell me your reported charge','give the current battery reading aloud','report the body\'s remaining charge'], [S]],
 [['greet me in your usual style','say hello in your personal voice','give a greeting shaped by your personality','greet me as yourself'], [P]],
 [['tell me your identity name','state the name in your persona','say what name identifies you','read your own name from your identity'], ['persona.identity']],
 [['describe your personal backstory','tell me your recorded origins','explain the background in your persona','describe your persona\'s history'], ['persona.background']],
 [['describe your personal values','tell me what your principles are','explain the values in your persona','state the beliefs recorded among your values'], ['persona.values']],
 [['tell me your persona goals','describe your personal ambitions','state the aspirations in your profile','explain your recorded long-term goals'], ['persona.goals']],
 [['list the available body commands','describe the advertised action interface','tell me what commands the bridge exposes','read the capability catalog aloud'], [E]],
 [['say exactly ready','repeat only the word ready','speak the literal word ready','give the spoken response ready'], []],
]
let trainingPairs = 0, evaluationPairs = 0
for (let a = 0; a < actions.length; a++) for (let b = 0; b < responses.length; b++) {
  // A fixed permutation distributes held-out combinations across all context kinds.
  const rank = (a * responses.length + b) * 37 % 160
  if (rank >= 155) continue
  const split: CaseSplit = rank < 125 ? 'development' : 'evaluation'
  split === 'development' ? trainingPairs++ : evaluationPairs++
  const [moves, taskContext] = actions[a]!, [speech, conversationContext] = responses[b]!
  family(`composition-${a}-${b}`, [
    `Please ${moves[0]} and ${speech[0]}.`,
    `${speech[1]!.charAt(0).toUpperCase()}${speech[1]!.slice(1)}; also ${moves[1]}.`,
    `I want you to ${moves[2]}. In your reply, ${speech[2]}.`,
    `Could you ${speech[3]}, and ${moves[3]} as well?`,
  ], taskContext, conversationContext, true, true, split)
}
if (trainingPairs !== 125 || evaluationPairs !== 30) throw new Error('Compositional partition changed')
