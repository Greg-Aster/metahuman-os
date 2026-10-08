import { addCase } from './development-cases.js'
const add = (suite: string, text: string[], selected: string[], query?: string) => addCase('intent', suite, text, selected, null, {}, 'development', query)
const speaking = ['needsResponse', 'needsPersona']
const movement = ['needsAction', 'needsEnvironment']
add('greeting', ['Hello.', 'Good morning.', 'Hi there.', 'Greetings.'], speaking)
add('thanks', ['Thank you.', 'Thanks for doing that.', 'I appreciate your help.', 'Much appreciated.'], speaking)
add('wellbeing', ['How are you today?', 'How has your day been?', 'How are things going for you?', 'How have you been doing?'], [...speaking, 'needsConversationHistory', 'needsRobotStatus'])
add('identity', ['Who are you?', 'Tell me your name.', 'How should I address you?', 'Introduce yourself.'], speaking)
add('values', ['What matters to you?', 'What do you value?', 'Describe your priorities.', 'Which principles are important to you?'], speaking)
add('goals', ['What are your goals?', 'What do you want to accomplish?', 'Tell me your current ambitions.', 'What are you working toward?'], speaking)
add('self-expression', ['Tell me a joke.', 'Make up a short poem.', 'Say something encouraging.', 'Invent a tiny story.'], speaking)
add('arithmetic', ['What is eight times seven?', 'Calculate twenty plus thirteen.', 'What is 81 divided by nine?', 'Subtract fifteen from forty.'], ['needsResponse'])
add('language', ['Translate the word hello into French.', 'Spell the word elephant.', 'Define the word orbit.', 'What is the plural of mouse?'], ['needsResponse'])
add('format', ['Reply with the word ready.', 'Say exactly: testing.', 'Read this aloud: the door is open.', 'Repeat the sentence: I like the rain.'], ['needsResponse'])
add('conversation-reference', ['What did I just ask you?', 'Repeat your previous answer.', 'Summarize our conversation.', 'What topic were we discussing?'], [...speaking, 'needsConversationHistory'])
add('personal-recall', ['What is the name of my cat?', 'What town did I say I grew up in?', 'What did I tell you my favorite food was?', 'Recall the name of my dog.'], [...speaking, 'needsConversationHistory', 'needsMemory'])
add('episodic-recall', ['What did you dream about yesterday?', 'Tell me about our discussion last week.', 'What happened during our last visit?', 'What did we decide the last time we discussed this?'], [...speaking, 'needsConversationHistory', 'needsMemory'])
add('explicit-recall', ['Search your memories for the garden project.', 'Look up what you remember about the garden project.', 'Retrieve stored notes about the garden project.', 'Find earlier memories relating to the garden project.'], ['needsResponse', 'needsMemory'], 'garden project')
add('buffer-only', ['Use our recent conversation to tell me the last topic.', 'Based on this chat, summarize what I wanted.', 'Read the recent conversation and repeat my last question.', 'Look at the conversation buffer and summarize our exchange.'], ['needsResponse', 'needsConversationHistory'])
add('status-battery', ['What is your battery level?', 'How much charge remains?', 'Report your battery percentage.', 'Tell me the current battery status.'], ['needsResponse', 'needsRobotStatus'])
add('status-activity', ['What are you doing right now?', 'Which task are you currently carrying out?', 'Tell me the status of your current activity.', 'What work is in progress?'], [...speaking, 'needsRobotStatus', 'needsExecutionContext'])
add('capabilities', ['What movements can this robot perform?', 'Can this body take a photograph?', 'Which commands are available?', 'Does this robot support generated motion?'], ['needsResponse', 'needsEnvironment'])
add('scene', ['What do you see?', 'Describe the scene in front of you.', 'What is visible through your camera?', 'Tell me what is in view.'], ['needsResponse', 'needsEnvironment', 'needsVision'])
add('visual-detail', ['What color is the object in front of you?', 'Is there a cup in the current image?', 'Read the sign visible to your camera.', 'How many objects can you see on the table?'], ['needsResponse', 'needsEnvironment', 'needsVision'])
add('fresh-image', ['Take a new picture.', 'Capture a camera frame now.', 'Photograph the scene.', 'Acquire a fresh image.'], movement)
add('movement-wave', ['Please wave.', 'Lift a front limb and wave it.', 'Give me one wave.', 'Perform a waving gesture.'], movement)
add('movement-bow', ['Please bow.', 'Give a short bow.', 'Lower the front of your body in a bow.', 'Make a bowing motion.'], movement)
add('movement-pushup', ['Do a pushup.', 'Lower and raise your body once.', 'Perform one push-up.', 'Give me a single push-up.'], movement)
add('movement-posture', ['Sit down.', 'Stand upright.', 'Rise into a standing pose.', 'Take a seated posture.'], movement)
add('movement-direction', ['Turn ninety degrees left.', 'Walk backward.', 'Advance forward one cycle.', 'Rotate a quarter turn to the right.'], movement)
add('movement-sequence', ['Sit and then stand.', 'Wave twice and bow.', 'Turn left, then nod.', 'Bow before walking forward.'], movement)
add('movement-novel', ['Stretch your rear left leg outward and bring it back.', 'Make three small body leans to the left.', 'Lower the front right leg slowly over two seconds.', 'Raise both front legs together for one second.'], movement)
add('movement-speech', ['Wave and tell me what you selected.', 'Bow, then give me a spoken acknowledgement.', 'Say hello while nodding.', 'Explain your selected motion and perform it.'], [...movement, ...speaking])
add('movement-silent', ['Wave silently.', 'Do a bow without speaking.', 'Just stand up; no spoken response.', 'Nod once and stay quiet.'], movement)
add('execution-stop', ['Stop what you are doing.', 'Cancel the current task.', 'End the activity in progress.', 'Stop the ongoing movement.'], ['needsExecutionContext', ...movement])
add('execution-steer', ['Keep going, but turn more slowly.', 'Change the current search target to the red cup.', 'Continue the existing task with a smaller stride.', 'While walking, reduce the forward speed.'], ['needsExecutionContext', ...movement])
add('execution-reference', ['Is that task finished yet?', 'Did the movement actually complete?', 'What happened to my previous request?', 'Why did your current task fail?'], ['needsResponse', 'needsConversationHistory', 'needsExecutionContext', 'needsRobotStatus'])
add('repeat-reference', ['Do that again.', 'Repeat the previous movement.', 'Perform the same sequence once more.', 'Make that gesture again.'], ['needsConversationHistory', ...movement])
add('visual-motion', ['Follow the visible red object.', 'Search for the blue cup and wave when you find it.', 'Move toward the item in the camera view.', 'Turn until the sign is visible, then stop turning.'], ['needsVision', ...movement])
add('negated-action', ['Do not wave; just say hello.', 'Explain bowing without doing it.', 'Tell me about walking, but stay still.', 'Describe a pushup without performing one.'], speaking)
add('quoted-language', ['Translate the phrase please wave into Spanish.', 'Count the words in do a pushup.', 'Spell the word bow.', 'What does the phrase sit down mean?'], ['needsResponse'])
add('hypothetical', ['If a robot could wave, what would that mean?', 'Explain why a robot might bow.', 'Describe how walking works in general.', 'What is a pushup?'], ['needsResponse'])
add('current-conditional', ['Check the battery and sit if it is below twenty percent.', 'If your reported posture is seated, stand up.', 'Use the current motor status to decide whether to wave.', 'Check whether you are sitting, and stand if you are.'], ['needsRobotStatus', 'needsEnvironment', 'needsAction'])
add('autonomous-choice', ['Choose a gesture that expresses your personality.', 'Pick an activity consistent with your goals.', 'Decide how you want to greet me using your body.', 'Select your own next activity based on your interests.'], ['needsPersona', ...movement])
add('history-and-motion', ['Use the movement sequence I described earlier.', 'Perform the gesture from our previous discussion.', 'Carry out my last movement instruction.', 'Do the exercise routine we just agreed on.'], ['needsConversationHistory', ...movement])
add('memory-and-motion', ['Perform the routine stored in your memories as morning exercise.', 'Recall our saved greeting routine and perform it.', 'Find the remembered dance sequence and execute it.', 'Use your stored movement routine for the evening stretch.'], ['needsMemory', ...movement])
add('vision-no-motion', ['Describe this image without moving.', 'Use the camera view to answer me, but make no movement.', 'Tell me which object is visible; do not approach it.', 'Identify the visible color and stay still.'], ['needsResponse', 'needsVision', 'needsEnvironment'])
add('status-no-history', ['Read only the current battery measurement.', 'Report the current motor state from robot status.', 'What is the latest reported posture?', 'Read the present body connection status.'], ['needsResponse', 'needsRobotStatus'])
add('response-no-persona', ['Return only the number 17.', 'Output the letters ABC.', 'Write the word acknowledged.', 'Reply with exactly two characters: OK.'], ['needsResponse'])
add('memory-query-travel', ['Search saved memories for our mountain trip.', 'Retrieve records about the mountain trip.', 'Find stored notes describing the mountain trip.', 'Recall your memories of the mountain trip.'], ['needsResponse', 'needsMemory'], 'mountain trip')
add('execution-specific', ['Cancel the search execution, but leave the other task alone.', 'Forward this correction to the task that is already running.', 'Stop the unfinished exercise routine.', 'Continue the active camera-inspection task.'], ['needsExecutionContext', ...movement])
add('observation-reference', ['What did the last camera observation show?', 'Describe what you saw on the previous scan.', 'Which object did you identify earlier?', 'Compare the current view with your recorded previous observation.'], ['needsResponse', 'needsEnvironment', 'needsVision', 'needsRobotStatus', 'needsExecutionContext'])
// Separate source families are never expanded into development training.
const heldOut: Array<[string, string[], string[]]> = [
 ['greeting', ['Good evening, friend.', 'Hello there, are you around?'], speaking],
 ['identity', ['What should I call you?', 'Describe your own character.'], speaking],
 ['wellbeing', ['Has today been treating you well?', 'How has everything been going since we last spoke?'], [...speaking,'needsConversationHistory','needsRobotStatus']],
 ['personal-recall', ['Remind me what I named my pet rabbit.', 'Which city did I tell you my sister lives in?'], [...speaking,'needsConversationHistory','needsMemory']],
 ['past-experience', ['Recall the dream you recorded two nights ago.', 'What was our conversation about last month?'], [...speaking,'needsConversationHistory','needsMemory']],
 ['arithmetic', ['Give the product of twelve and four.', 'How many minutes are there in two hours?'], ['needsResponse']],
 ['capability', ['Is a sideways gait part of your advertised interface?', 'List the effects this body can execute.'], ['needsResponse','needsEnvironment']],
 ['telemetry', ['Read out your remaining charge.', 'What charge percentage is reported now?'], ['needsResponse','needsRobotStatus']],
 ['motion', ['Give a nod followed by a bow.', 'Take one backward step and sit.'], movement],
 ['motion-speech', ['Greet me aloud and give a little wave.', 'Bow once and announce the selected activity.'], [...movement,...speaking]],
 ['novel-motion', ['Extend the left rear limb, hold for three seconds, then retract it.', 'Make two deliberate rightward torso tilts.'], movement],
 ['stop', ['Terminate the activity you are executing.', 'Please end the ongoing routine.'], ['needsExecutionContext',...movement]],
 ['steer', ['Change the in-progress search to look for a mug.', 'Keep the same task but lower its movement speed.'], ['needsExecutionContext',...movement]],
 ['repeat', ['Once more, the way you just did it.', 'Repeat that sequence from our last exchange.'], ['needsConversationHistory',...movement]],
 ['vision', ['Describe the arrangement visible to your camera.', 'What is written on the visible label?'], ['needsResponse','needsVision','needsEnvironment']],
 ['no-execution', ['Explain what the instruction bow means; do not carry it out.', 'Discuss waving as a gesture without making it.'], speaking],
 ['quote', ['Translate walk backward into German.', 'How many letters are in the word wave?'], ['needsResponse']],
 ['fresh-image', ['Acquire another photograph now.', 'Request a new camera exposure.'], movement],
 ['task-report', ['Has the movement I requested reached completion?', 'What became of the earlier task?'], ['needsResponse','needsConversationHistory','needsExecutionContext','needsRobotStatus']],
 ['self-choice', ['Select a body expression that suits your values.', 'Pick what you want to do based on your goals.'], ['needsPersona',...movement]],
]
for (const [suite, text, selected] of heldOut) addCase('intent', suite, text, selected, null, {}, 'evaluation')
