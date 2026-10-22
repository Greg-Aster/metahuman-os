import { addCase, intentOutput, type CaseSplit } from './development-cases.js'

// Sanitized offline examples. They do not change runtime instructions or route
// requests in code. Stable IDs and explicit folds keep related contrasts together
// regardless of the registration order of other corpus modules.
type Split = Extract<CaseSplit, 'development' | 'evaluation'>
const H = 'conversationHistory', M = 'memory', E = 'environment', V = 'vision'
function family(name: string, split: Split, fold: number, instructions: string[],
  context: string[], scope: Record<string, unknown> = {}) {
  const source = addCase('intent', `memory-${name}`, instructions, [], {
    ...intentOutput([], context), taskPlanner: 'specialist', ...scope,
  }, {}, split)
  source.id = `intent-${split}-memory-${name}`
  source.fold = fold
  return source
}

const visualDevelopment = ['ceramic vase', 'folding ladder', 'silver teapot', 'patterned curtain']
for (const [fold, subject] of visualDevelopment.entries()) {
  const name = subject.replaceAll(' ', '-')
  family(`visual-${name}-spoken`, 'development', fold, [
    `What did you say about the ${subject} in your preceding reply?`,
    `Repeat the description of the ${subject} you gave me in this conversation.`,
    `When we were discussing the ${subject} a moment ago, how did you describe it?`,
  ], [H])
  family(`visual-${name}-observation`, 'development', fold, [
    `Read the retained observation history about the ${subject}; do not request a current image.`,
    `What does the saved observation history record about the ${subject}? Use those observations, not our dialogue.`,
    `Summarize the recorded visual observations of the ${subject} already available in the environment context.`,
  ], [E])
  family(`visual-${name}-current`, 'development', fold, [
    `Describe the ${subject} in the camera view now.`,
    `Look at the current image and tell me what the ${subject} looks like.`,
    `What is visible around the ${subject} in your present view?`,
  ], [E, V])
}

family('visual-brass-lamp-spoken', 'evaluation', 0, [
  'Remind me how you characterized the brass lamp when answering my last message.',
  'Your last answer mentioned a brass lamp. What were your words about its appearance?',
], [H])
family('visual-brass-lamp-observation', 'evaluation', 0, [
  'Consult the environment observation history for the brass lamp and report what that record says.',
  'Without checking another image, read the retained visual observation about the brass lamp.',
], [E])
family('visual-brass-lamp-current', 'evaluation', 0, [
  'Inspect what the camera presently shows around the brass lamp.',
  'Tell me how the brass lamp appears in the view available now.',
], [E, V])
family('visual-red-bookcase-spoken', 'evaluation', 1, [
  'We were talking about the red bookcase. Recall the description you gave in that exchange.',
  'In your preceding message, what did you tell me was beside the red bookcase?',
], [H])
family('visual-red-bookcase-observation', 'evaluation', 1, [
  'Use the recorded environment observations to report the red bookcase, rather than inspecting a fresh view.',
  'What details about the red bookcase are present in the retained observation log?',
], [E])
family('visual-red-bookcase-current', 'evaluation', 1, [
  'From the image in view at this moment, describe the red bookcase.',
  'What can you see beside the red bookcase right now?',
], [E, V])

const queryTopics = [
  ['seed-exchange', 'seed exchange schedule'],
  ['telescope-repair', 'telescope focusing repair'],
  ['bicycle-fitting', 'bicycle saddle adjustment'],
  ['bread-recipe', 'rye bread recipe'],
  ['train-trip', 'coastal train itinerary'],
  ['pottery-glaze', 'pottery glaze experiment'],
  ['bird-feeder', 'bird feeder placement'],
  ['museum-exhibit', 'museum textile exhibit'],
] as const
for (const [index, [name, topic]] of queryTopics.entries()) {
  family(`query-${name}`, 'development', index % 4, [
    `Find saved information about the ${topic}.`,
    `What do your memories say about the ${topic}?`,
    `Retrieve the stored account of our ${topic}.`,
  ], [M], { memoryQuery: topic })
}
for (const [index, [name, topic, requests]] of ([
  ['canoe-route', 'canoe portage route', [
    'Consult your long-term records for the canoe portage route we discussed.',
    'Which details of the canoe portage route did we preserve in memory?',
  ]],
  ['quilt-pattern', 'patchwork quilt pattern', [
    'Recall what was saved concerning the patchwork quilt pattern.',
    'Search the memory collection for our patchwork quilt pattern discussion.',
  ]],
  ['violin-lesson', 'violin bowing lesson', [
    'Bring back the stored notes concerning the violin bowing lesson.',
    'Look through past memories for information on the violin bowing lesson.',
  ]],
  ['stone-arch', 'stone arch restoration', [
    'Use persistent memory to recall the stone arch restoration.',
    'Tell me what we recorded about the stone arch restoration project.',
  ]],
] as const).entries()) family(`query-${name}`, 'evaluation', index, [...requests], [M], { memoryQuery: topic })

// Record types identify the requested evidence class. A typed record remains an
// attributed claim; these routes do not certify the truth of its contents.
const typedTopics = [
  ['conversation', 'discussion of the community orchard', 'discussion of the harbor festival'],
  ['observation', 'observation of the windowsill plants', 'observation of the courtyard fountain'],
  ['reflection', 'reflection on the chess lesson', 'reflection on the choir rehearsal'],
  ['reflection_summary', 'reflection summary about the ceramic workshop', 'reflection summary about the dance class'],
  ['dream', 'dream about a floating library', 'dream about a glass forest'],
  ['daydream', 'daydream about a paper submarine', 'daydream about a clockwork island'],
  ['audio', 'audio transcript of the recipe dictation', 'audio transcript of the travel briefing'],
  ['curiosity', 'curiosity question about migrating butterflies', 'curiosity question about lunar craters'],
  ['action', 'recorded action involving the blue basket', 'recorded action involving the yellow tray'],
  ['tool_invocation', 'tool invocation for the tide-table lookup', 'tool invocation for the sunrise lookup'],
  ['inner_dialogue', 'inner thought about learning origami', 'inner thought about learning calligraphy'],
] as const
for (const [index, [type, topic, heldOutTopic]] of typedTopics.entries()) {
  family(`type-${type}`, 'development', index % 4, [
    `Retrieve the saved ${topic}.`,
    `Find the ${topic} in records of type ${type}.`,
  ], [M], { memoryQuery: topic, memoryTypes: [type] })
  family(`type-heldout-${type}`, 'evaluation', index % 4, [
    `Recall the ${heldOutTopic} from your saved ${type} records.`,
    `Search persistent memory for the ${heldOutTopic}, restricted to ${type}.`,
  ], [M], { memoryQuery: heldOutTopic, memoryTypes: [type] })
}

for (const [index, [type, noun]] of ([
  ['dream', 'dream'], ['daydream', 'daydream'], ['reflection', 'reflection'],
  ['observation', 'observation'], ['inner_dialogue', 'inner thought'],
] as const).entries()) {
  family(`newest-${type}`, 'development', index % 4, [
    `Retrieve your most recently saved ${noun} and its recorded time.`,
    `Which ${noun} was recorded last? Use the saved records.`,
  ], [M], { memoryQuery: noun, memoryTypes: [type], memoryOrder: 'newest' })
}
family('newest-conversation', 'evaluation', 0, [
  'Read the latest saved conversational record according to its timestamp.',
  'Show the newest entry of type conversation from long-term memory.',
], [M], { memoryQuery: 'conversation', memoryTypes: ['conversation'], memoryOrder: 'newest' })
family('newest-curiosity', 'evaluation', 1, [
  'What is the most recently recorded curiosity question?',
  'Retrieve curiosity records in order of recording time, newest first.',
], [M], { memoryQuery: 'curiosity question', memoryTypes: ['curiosity'], memoryOrder: 'newest' })
family('newest-audio', 'evaluation', 2, [
  'Which saved audio transcript has the latest recorded timestamp?',
  'Read the newest audio memory and include when it was recorded.',
], [M], { memoryQuery: 'audio transcript', memoryTypes: ['audio'], memoryOrder: 'newest' })

// Every absolute timestamp is supplied by the request. The Intent call has no
// implicit clock, so calendar-relative requests are not given invented dates.
const absoluteIntervals = [
  ['development', 'lantern', 'lantern assembly', '2031-04-03T08:00:00+02:00', '2031-04-04T08:00:00+02:00'],
  ['development', 'terrarium', 'terrarium humidity', '2031-06-17T00:00:00Z', '2031-06-18T00:00:00Z'],
  ['development', 'sundial', 'sundial alignment', '2032-02-11T09:30:00-05:00', '2032-02-11T17:30:00-05:00'],
  ['development', 'weaving', 'weaving loom setup', '2032-09-21T00:00:00+09:00', '2032-09-22T00:00:00+09:00'],
  ['evaluation', 'barometer', 'barometer calibration', '2033-03-09T10:15:00-07:00', '2033-03-09T14:45:00-07:00'],
  ['evaluation', 'mosaic', 'mosaic layout', '2033-08-02T00:00:00+01:00', '2033-08-03T00:00:00+01:00'],
] as const
for (const [index, [split, name, topic, from, before]] of absoluteIntervals.entries()) {
  family(`interval-${name}`, split, index % 4, split === 'development' ? [
    `Find memories about ${topic} recorded from ${from} inclusive until ${before} exclusive.`,
    `Search the saved ${topic} records at or after ${from}, but strictly before ${before}.`,
  ] : [
    `Recall ${topic} only within this recorded-time interval: [${from}, ${before}).`,
    `Locate memories about ${topic}; the inclusive start is ${from} and the exclusive end is ${before}.`,
  ], [M], { memoryQuery: topic, memoryTimeRange: { from, before } })
}
family('time-from-only', 'development', 0, [
  'Recall the indoor herb plan recorded at or after 2034-01-19T11:00:00Z; no upper time bound is requested.',
  'Search saved indoor herb plan records from 2034-01-19T11:00:00Z onward, including that instant.',
], [M], { memoryQuery: 'indoor herb plan', memoryTimeRange: { from: '2034-01-19T11:00:00Z' } })
family('time-before-only', 'evaluation', 3, [
  'Find saved notes about the ceramics inventory dated strictly before 2034-05-08T16:30:00+03:00.',
  'Recall the ceramics inventory from records older than 2034-05-08T16:30:00+03:00; no lower date bound.',
], [M], { memoryQuery: 'ceramics inventory', memoryTimeRange: { before: '2034-05-08T16:30:00+03:00' } })

family('latest-sleep-dreams', 'development', 1, [
  'Retrieve the dreams recorded within your latest sleep cycle.',
  'What dream records belong to the most recently recorded sleep session?',
  'Read dreams associated with the latest sleep cycle, including its recorded state.',
], [M], { memoryQuery: 'dream', memoryTypes: ['dream'], memorySleepCycle: 'latest' })
family('latest-sleep-newest-dream', 'development', 1, [
  'What was the last dream recorded within the latest sleep cycle?',
  'Read the newest dream from your most recently recorded sleep session.',
], [M], { memoryQuery: 'dream', memoryTypes: ['dream'], memorySleepCycle: 'latest', memoryOrder: 'newest' })
family('latest-sleep-reflections', 'evaluation', 2, [
  'Recall reflections that were saved during the most recent recorded sleep cycle.',
  'Read the reflection memories belonging to your latest sleep session.',
], [M], { memoryQuery: 'reflection', memoryTypes: ['reflection'], memorySleepCycle: 'latest' })
family('latest-sleep-newest-thought', 'evaluation', 2, [
  'Retrieve the newest inner thought associated with the latest recorded sleep cycle.',
  'Which inner-dialogue entry was recorded last within the most recent sleep session?',
], [M], { memoryQuery: 'inner thought', memoryTypes: ['inner_dialogue'], memorySleepCycle: 'latest', memoryOrder: 'newest' })
