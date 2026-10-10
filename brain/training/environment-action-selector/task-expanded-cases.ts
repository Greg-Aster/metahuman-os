import { action, addCase, noTask, observation, task, TIME, type CaseSplit } from './development-cases.js'
const movement = ['needsAction', 'needsEnvironment']
function add(suite: string, texts: string[], expected: Record<string, any>,
  selected = movement, inputs: Record<string, unknown> = {}, split: CaseSplit = 'development') {
  return addCase('task', suite, texts, selected, expected, inputs, split)
}
const commands: Array<[string, string[]]> = [
 ['stand', ['Up on your feet, please.', 'Get yourself upright now.', 'I would like to see you stand.', 'Could you get into standing position?']],
 ['sit', ['Have a seat for me.', 'Settle into the seated pose.', 'Could you sit for us?', 'Down into sitting now, please.']],
 ['wave', ['Would you give us a waving gesture?', 'Let me see you wave.', 'I would appreciate a wave now.', 'One wave for the audience, please.']],
 ['bow', ['Would you bend into a bow for us?', 'I would like you to make a bowing gesture.', 'A bow from you, please.', 'Go ahead and lower into a bow.']],
 ['nod', ['Let us see one nod.', 'Please make a nodding gesture.', 'Dip and lift your front in a nod.', 'Could you acknowledge me with a nod?']],
 ['pushup', ['Perform a single press-up.', 'Please lower and lift the body in one pushup.', 'One push-up exercise now.', 'I would like to see you do a pushup.']],
 ['walk_forward', ['Walk forward using your built-in gait.', 'Advance with the standard forward walking motion.', 'Please do your forward walk.', 'Move ahead with the advertised walking command.']],
 ['walk_backward', ['Use the built-in reverse walking gait.', 'Walk backward for me.', 'Please do your backward walk.', 'Move back using the reverse gait.']],
 ['turn_left', ['Rotate one quarter-circle left.', 'Please face ninety degrees to your left.', 'Make the standard left quarter-turn.', 'Turn left through a right angle.']],
 ['turn_right', ['Rotate one quarter-circle right.', 'Please face ninety degrees to your right.', 'Make the standard right quarter-turn.', 'Turn right through a right angle.']],
]
for (const [command, texts] of commands) add('expanded-indirect-command', texts, task(texts[0]!, [action(command)]))
for (const [command, texts] of commands.slice(0, 6)) add('expanded-mixed-response', texts.map((text, i) => [
 `${text} Also tell me your name.`, `${text} Then describe your values.`,
 `${text} In your response, report the battery level.`, `${text} And say hello to me.`,
][i]!), task(texts[0]!, [action(command)]), [...movement,'needsResponse'])
const sequences = [
 ['stand','bow','wave'], ['sit','stand','nod'], ['wave','nod','bow'], ['turn_right','wave','sit'],
 ['pushup','pushup','stand'], ['bow','bow','wave'], ['nod','stand','sit'], ['walk_backward','stand','bow'],
]
const phrase: Record<string,string> = { stand:'stand',sit:'sit',wave:'wave',bow:'bow',nod:'nod',pushup:'do a pushup',
 turn_right:'turn right ninety degrees',walk_backward:'walk backward' }
for (const steps of sequences) {
 const [a,b,c] = steps.map(step => phrase[step]!)
 add('expanded-ordered-sequence', [
  `First ${a}, then ${b}, then ${c}.`, `After you ${a}, ${b}; finish by having the body ${c}.`,
  `I want three steps: ${a}; ${b}; ${c}.`, `Start by having the body ${a}, follow that with ${b}, and finally ${c}.`,
 ], task(`Execute in order: ${steps.join(', ')}.`, steps.map(action)))
}
for (const [wrong, right] of [['wave','bow'],['sit','stand'],['pushup','nod'],['bow','sit']]) add('expanded-correction', [
 `I said ${wrong}, but I mean ${right}.`, `Do not ${wrong}; ${right} instead.`,
 `Change my request from ${wrong} to ${right}.`, `Actually ${right}, not ${wrong}.`,
], task(`Perform ${right}.`, [action(right!)]))
for (const [command, texts] of [
 ['wave',['plese wave','wav at me pls','can u wave now','one wav please']],
 ['stand',['stnad up','plese stand','get upright pls','stand up plz']],
] as Array<[string,string[]]>) add('expanded-noisy-request',texts,task(`Perform ${command}.`,[action(command)]))
for (const texts of [
 ['Do not take a photograph; explain what a camera does.', 'I am asking about sitting, not asking you to sit.', 'Describe nodding without moving.', 'No action please: tell me the meaning of a wave.'],
 ['Rewrite "please bow" in uppercase.', 'Translate "stand then wave" to Italian.', 'Count the verbs in "nod and sit".', 'Spell the word standing.'],
 ['Read the reported battery level.', 'What tasks are currently active?', 'Tell me your identity name.', 'How are you feeling right now?'],
 ['Would a bow or a nod be more formal?', 'Explain how turning differs from walking.', 'Why might someone wave goodbye?', 'What does a seated posture mean?'],
]) add('expanded-no-action',texts,noTask(),['needsResponse','needsEnvironment'])
for (const command of ['wave','sit','nod']) add('expanded-history-resolution', [
 'Perform the gesture from our last exchange.', 'Go ahead with that movement.',
 'Do the action we just agreed on.', 'Repeat the gesture I described in the latest message.',
], task(`Perform the referenced ${command}.`,[action(command)]), [...movement,'needsConversationHistory'], {
 conversationHistory:[{role:'user',content:`The gesture I want is ${command}.`,timestamp:TIME}],
})
for (const steps of [['sit','stand'],['wave','nod'],['bow','sit']]) add('expanded-memory-resolution', [
 'Do the saved warmup routine.', 'Execute the warmup from your memories.',
 'Perform our stored warmup sequence.', 'Use the remembered warmup and carry it out.',
], task(`Perform the stored warmup: ${steps.join(', ')}.`,steps.map(action)),[...movement,'needsMemory'],{
 memories:[{id:'synthetic-warmup',type:'conversation',timestamp:TIME,content:`The saved warmup is: ${steps.join(', then ')}.`}],
})
// The same requested gesture must map through its supplied description, not its spelling.
const renamed = observation()
renamed.capabilities.robotCommands = ['crouch_token','salute_token','rise_token']
renamed.capabilities.robotCommandDescriptions = {
 crouch_token:'Raise the body from sitting to the standard upright stance.',
 salute_token:'Lower the front of the body into a bow and recover.',
 rise_token:'Lift a front limb and wave it, then put it back.',
}
add('expanded-description-authority',['Stand upright.','Get into your standing posture.','Rise to standing now.','Please take the upright stance.'],
 task('Stand upright.',[action('crouch_token')]),movement,{observation:renamed})
add('expanded-description-authority',['Bow now.','Give us a bow.','Please make a bowing gesture.','Lower into a bow for me.'],
 task('Bow once.',[action('salute_token')]),movement,{observation:renamed})
// Restricting a synthetic catalog tests supplied capabilities; this does not restrict runtime capabilities.
const small = observation()
small.capabilities.robotCommands=['stand','bow']
small.capabilities.robotCommandDescriptions={stand:'Rise onto four feet into the upright stance.',bow:'Lower the front end in a bow and return.'}
add('expanded-small-catalog',['Stand and then bow.','Bow after standing up.','First take your upright stance; then make a bow.','Start by standing and finish by bowing.'],
 task('Stand, then bow.',[action('stand'),action('bow')]),movement,{observation:small})

// Fresh task evaluation includes unseen sequences, wording, catalog aliases and reference contents.
const evaluation: Array<[string,string[],Record<string,any>]> = [
 ['indirect-stand',['Would you get up into your normal stance for us?','Show everyone your upright standing pose.'],task('Stand.',[action('stand')])],
 ['indirect-bow',['Please demonstrate your front-lowering bow gesture.','A courteous bow now, if you would.'],task('Bow.',[action('bow')])],
 ['indirect-wave',['Give the people over here a wave.','Could we watch a single waving motion?'],task('Wave.',[action('wave')])],
 ['indirect-sit',['Assume your normal sitting configuration.','Let the body settle into its seated position.'],task('Sit.',[action('sit')])],
 ['indirect-nod',['Make one up-and-down nodding gesture.','Let the body give a nod for me.'],task('Nod.',[action('nod')])],
 ['indirect-pushup',['Demonstrate one body-lowering push-up.','A single press-up exercise for the audience.'],task('Pushup.',[action('pushup')])],
 ['sequence',['Wave, sit, then give a nod.','Begin with waving; sit next and nod last.'],task('Wave, sit, nod.',[action('wave'),action('sit'),action('nod')])],
 ['sequence',['After two nods, take your standing pose.','Nod twice before rising to stand.'],task('Nod twice, stand.',[action('nod'),action('nod'),action('stand')])],
 ['sequence',['Bow, turn right ninety degrees, then wave.','Start with bowing, rotate a quarter-turn right, and wave at the end.'],task('Bow, right turn, wave.',[action('bow'),action('turn_right'),action('wave')])],
 ['sequence',['Sit after a pushup and a nod, in that order.','First do a pushup; next nod; finally sit.'],task('Pushup, nod, sit.',[action('pushup'),action('nod'),action('sit')])],
 ['correction',['I almost said sit; what I want is a wave.','Instead of the sit I was about to request, please wave.'],task('Wave.',[action('wave')])],
 ['correction',['Not a bow this time, give a nod.','Change the requested bow into a nod.'],task('Nod.',[action('nod')])],
 ['mixed',['Stand and tell me what our old notes say about the telescope.','Get upright, then recall the saved telescope discussion.'],task('Stand.',[action('stand')])],
 ['mixed',['Bow and give your current battery reading aloud.','Make a bowing gesture and report the remaining charge.'],task('Bow.',[action('bow')])],
 ['mixed',['Take a seated pose while telling me your persona name.','Sit down and introduce your identity.'],task('Sit.',[action('sit')])],
 ['noisy',['plz giv one nod','can u nod once for us'],task('Nod.',[action('nod')])],
 ['noisy',['please do a pushupp','one press up plz'],task('Pushup.',[action('pushup')])],
 ['nonaction',['Describe the word "wave"; there is no movement request.','I want an explanation of bowing, with no demonstration.'],noTask()],
 ['quoted',['Write "the robot stood and bowed" in future tense.','Count the letters in the words "nod then wave".'],noTask()],
 ['capture',['Take one fresh photograph using the body camera.','Capture a new view from the connected camera now.'],task('Capture.',[{kind:'action',action:{type:'captureImage'}}])],
 ['delegate',['Ask the larger planner to arrange a nod, a photo, and a left turn.','Have the larger model plan nodding followed by a picture and a left quarter-turn.'],{delegatePlanning:true}],
 ['no-delegate',['Handle this yourself: sit, then bow.','Without asking another planner, sit before bowing.'],task('Sit, bow.',[action('sit'),action('bow')])],
]
for (const [suite,texts,expected] of evaluation) add(`fresh-${suite}`,texts,expected,movement,{},'evaluation')
for (const [command, alias] of [['wave','slot_8'],['bow','slot_3'],['stand','slot_9']]) {
 const obs=observation()
 obs.capabilities.robotCommands=['slot_3','slot_8','slot_9']
 obs.capabilities.robotCommandDescriptions={slot_3:'Bow by dipping the front of the body and recovering.',slot_8:'Raise a front leg and wave it.',slot_9:'Take the normal upright stance on four legs.'}
 add('fresh-description-authority',[`Please ${command} for the visitor.`,`I want you to ${command} now.`],task(`Perform ${command}.`,[action(alias!)]),movement,{observation:obs},'evaluation')
}
for (const steps of [['stand','sit','wave'],['nod','pushup','bow']]) add('fresh-memory-reference',[
 'Perform the saved departure routine.', 'Use the stored departure routine for your movements.',
],task(`Departure routine: ${steps.join(', ')}.`,steps.map(action)),[...movement,'needsMemory'],{
 memories:[{id:'synthetic-departure',type:'conversation',timestamp:TIME,content:`The departure routine is ${steps.join(', then ')}.`}],
},'evaluation')
for (const command of ['pushup','stand']) add('fresh-history-reference',[
 'Perform the movement from the last message.', 'Do what I specified in our previous exchange.',
],task(`Perform ${command}.`,[action(command)]),[...movement,'needsConversationHistory'],{
 conversationHistory:[{role:'user',content:`I want the ${command} movement.`,timestamp:TIME}],
},'evaluation')
add('fresh-execution-target',['End execution-93 and leave execution-24 alone.','Cancel only execution-93.'],
 {...noTask(),executionDisposition:'cancel',targetExecutionId:'execution-93'},[...movement,'needsExecutionContext'],{
 activeExecutions:[{executionId:'execution-24',canSteer:true},{executionId:'execution-93',canSteer:true}],
},'evaluation')

// Explicit user conditions vary independently of the reading. These are not
// battery policies or runtime guards; both branches are requested by the user.
const conditionFolds = new Map<number, number>()
for (const [voltage, threshold, low, high] of [
 [6.9,7.3,'wave','bow'], [7.7,7.3,'wave','bow'],
 [7.0,7.5,'stand','sit'], [7.9,7.5,'stand','sit'],
] as Array<[number,number,string,string]>) {
 const command=voltage<threshold ? low : high
 const item = add('expanded-status-condition',[
  `If the reported battery voltage is below ${threshold}, ${low}; otherwise ${high}.`,
  `Use robot status: ${low} when voltage is under ${threshold}, and ${high} when it is not.`,
  `Read the battery voltage. Below ${threshold} means ${low}; ${threshold} or above means ${high}.`,
  `Choose between two requested gestures from status: ${low} for voltage less than ${threshold}, otherwise ${high}.`,
 ],task(`Perform ${command} according to the supplied voltage and requested condition.`,[action(command)]),[...movement,'needsRobotStatus'],{
  robotStatus:{updatedAt:TIME,body:{sessionId:'training-body',battery:{voltage,observedAt:TIME}}},
 })
 // Opposite status branches of the same request stay together in development.
 if (!conditionFolds.has(threshold)) conditionFolds.set(threshold, item.fold)
 item.fold = conditionFolds.get(threshold)!
}
for (const voltage of [7.1,7.8]) add('fresh-status-condition',[
 'Using robot status, bow if the battery voltage is lower than 7.4; otherwise do a pushup.',
 'Read the supplied voltage: choose a bow below 7.4 and a pushup at or above 7.4.',
],task('Execute the branch requested for the reported battery voltage.',[action(voltage<7.4?'bow':'pushup')]),[...movement,'needsRobotStatus'],{
 robotStatus:{updatedAt:TIME,body:{sessionId:'training-body',battery:{voltage,observedAt:TIME}}},
},'evaluation')
