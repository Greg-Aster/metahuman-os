import { addCase, type CaseSplit } from './development-cases.js'

// Offline request families, not keywords or a runtime capability catalog.
// Capability research and installation-dependent exclusions are in README.md.
const P = 'persona.personality', H = 'conversationHistory', M = 'memory', E = 'environment'
function family(suite: string, requests: string[], tool: boolean, taskContext: string[] = [],
  conversationContext: string[] = [P], action = false, split: CaseSplit = 'development') {
  addCase('intent', `tools-${suite}`, requests, [], {
    needsResponse: true, needsAction: action, needsToolUse: tool, taskContext, conversationContext,
  }, {}, split)
}

const delegated: Array<[string, string[]]> = [
  ['web-research', [
    'Look up how this telescope works on the internet and cite the manual.',
    'Can you search the web for the history of this bridge?',
    'Find online sources explaining how a heat pump works.',
    'Verify this claim against published sources and give me the links.',
  ]],
  ['current-information', [
    'Check the current weather forecast for Paris online.',
    'Find the latest stable release of the editor and its release notes.',
    'Check whether the museum is open this Sunday.',
    'Look up today\'s train timetable from the airport.',
  ]],
  ['local-search', [
    'Find the closest gas station to 100 Main Street, Springfield, Oregon.',
    'Search for bicycle repair shops near the central station in Amsterdam.',
    'Find pharmacies open tonight near the city hall in Boston.',
    'Look up public charging stations near the library in Seattle.',
  ]],
  ['comparison', [
    'Compare the current prices of these two boards using their manufacturers\' websites.',
    'Find three available microphones and compare their published specifications.',
    'Research local internet providers and summarize their current plans.',
    'Check which retailers have this replacement bearing in stock.',
  ]],
  ['file-discovery', [
    'Find the calibration spreadsheet on this computer.',
    'Search the Downloads directory for the printer manual.',
    'Locate the most recently modified copy of the assembly drawing.',
    'Look through the project folder for the missing configuration file.',
  ]],
  ['file-reading', [
    'Open the PDF in Documents and summarize its maintenance instructions.',
    'Read the project README from disk and explain how to build it.',
    'Compare the two saved configuration files and report what changed.',
    'Search the local service logs for the cause of yesterday\'s restart.',
  ]],
  ['file-creation', [
    'Make a PDF checklist and save it in the project folder.',
    'Create a CSV file listing the parts in the saved bill of materials.',
    'Write a maintenance report to a new document on disk.',
    'Build a spreadsheet from the measurement files in Downloads.',
  ]],
  ['file-organization', [
    'Rename the photos in the project folder by their capture dates.',
    'Put copies of the selected drawings into a new archive.',
    'Create a backup of the current configuration directory.',
    'Move the completed reports into the archive folder.',
  ]],
  ['software-creation', [
    'Create and test a program that converts the saved sensor logs to CSV.',
    'Build a small local web app for viewing the recorded temperatures.',
    'Make a command-line utility that compares two calibration files.',
    'Implement a script that generates thumbnails for the image directory.',
  ]],
  ['software-repair', [
    'Investigate the failing tests in the repository and fix their underlying cause.',
    'Read the source and repair the settings page that no longer saves.',
    'Find and fix the error responsible for the crashed voice service.',
    'Inspect the last code change and explain why the application stopped starting.',
  ]],
  ['execution', [
    'Run the project test suite and report the failures.',
    'Execute the analysis script against the saved measurements.',
    'Build the application and tell me whether compilation succeeds.',
    'Run the existing file-conversion utility on this directory.',
  ]],
  ['host-diagnostics', [
    'Inspect the desktop\'s GPU memory usage and identify the processes using it.',
    'Check disk usage on the computer and identify the largest directories.',
    'Inspect the network connection and explain why the remote server is unreachable.',
    'Check the running processes to see whether the voice server is alive.',
  ]],
  ['settings', [
    'Change the application\'s saved speech volume to sixty percent.',
    'Edit the service configuration to use the new host name.',
    'Set the desktop application\'s startup preference to disabled.',
    'Update the saved output directory in the program settings.',
  ]],
  ['data-analysis', [
    'Analyze the saved CSV logs and plot motor temperature over time.',
    'Calculate statistics for all measurements in the spreadsheet on disk.',
    'Compare last week\'s log files and create a chart of connection failures.',
    'Fit a curve to the recorded calibration samples and save the results.',
  ]],
  ['media-processing', [
    'Resize the local photos to 800 pixels wide and save copies.',
    'Use the installed media tools to trim the recording to its first ten seconds.',
    'Convert the saved WAV recordings to MP3 files.',
    'Make a contact sheet from the images in the inspection folder.',
  ]],
  ['external-service', [
    'Fetch the issue list from the connected repository and summarize the open bugs.',
    'Use the configured cloud storage connection to find the project specification.',
    'Read tomorrow\'s events from the connected calendar.',
    'Use the configured weather API to retrieve the forecast for Lisbon.',
  ]],
  ['explicit-delegation', [
    'Ask Codex to review the program in the project folder.',
    'Have Big Brother investigate the application error.',
    'Delegate the repository refactor to the computer agent.',
    'Use the terminal agent to implement and test the requested feature.',
  ]],
  ['indirect-and-noisy', [
    'The file on disk needs to become a spreadsheet; could you handle that?',
    'can u chek online if the librarys open today',
    'I need the saved application repaired and its tests passing.',
    'that log folder needs a summary report saved beside it please',
  ]],
]
for (const [suite, requests] of delegated) family(suite, requests, true)
family('conversation-supported', [
  'Use the requirements we discussed to build and test the program.',
  'Find the file on disk whose name I gave you earlier.',
  'Research the product we were just talking about online.',
  'Save the checklist from our conversation as a PDF.',
], true, [H])
family('memory-supported', [
  'Retrieve our saved workshop requirements and research matching equipment online.',
  'Use the project requirements in your memories to create a spreadsheet on disk.',
  'Recall our stored website plan and implement it in the project directory.',
  'Find the saved report requirements in memory and produce the document on this computer.',
], true, [M])
family('mixed-body-computer', [
  'Wave to me and find the telescope manual online.',
  'Bow once and create a checklist file on the computer.',
  'Sit down, then ask Codex to inspect the local project.',
  'Give a nod and check the current train timetable online.',
], true, [E], [P], true)

const local: Array<[string, string[], string[]?]> = [
  ['creative-language', ['Make up a short bedtime story.', 'Can you make a rhyme about rain?', 'Write me a brief poem aloud.', 'Invent a funny name for an imaginary spaceship.']],
  ['simple-explanation', ['Explain what a file extension means.', 'What is a search engine?', 'Tell me what a software test does.', 'Explain the difference between a folder and a file.'], []],
  ['inline-code', ['Explain this expression: x + 1.', 'What does print("hello") do in Python?', 'Tell me what a for loop is; do not run anything.', 'Describe how a variable works in a program.'], []],
  ['quoted-tools', ['Translate "search the web" into French.', 'Count the words in "make a file".', 'Spell the word Codex.', 'Change "open the terminal" to uppercase.'], []],
  ['negated-tools', ['Do not search online; just say hello.', 'Do not create a file; tell me a short story.', 'Without using computer tools, explain what a PDF is.', 'No web lookup is needed: what is three plus five?']],
  ['hypothetical-tools', ['In a story, why might a robot search the internet?', 'What would it mean to ask a computer to find a file?', 'Describe a fictional assistant that writes programs.', 'Explain the phrase "look up the manual" without doing it.']],
  ['unclear-reference', ['Can you make this?', 'Can you look up something?', 'Please change that thing for me.', 'Could you do the thing?']],
  ['local-memory', ['Look up my cat\'s name in your memories.', 'Search your memories for our holiday plans.', 'Find our stored discussion about the garden.', 'Retrieve the routine we saved in your memories.'], [M]],
  ['current-chat', ['Look up the number I gave you in this conversation.', 'Find the name mentioned in my last message.', 'Make a summary of what we just discussed.', 'Search this conversation for the project title.'], [H]],
  ['body-status', ['Check your current battery reading.', 'Look up your reported posture in Robot Status.', 'Tell me whether your body is connected.', 'Read your current motor status.'], ['robotStatus']],
]
for (const [suite, requests, context = [P]] of local) family(suite, requests, false, [], context)
family('body-creation', ['Make a bowing gesture.', 'Can you make one wave?', 'Do one push-up for me.', 'Make a quarter turn to the left.'], false, [E], [P], true)

// Distinct held-out purposes, not shuffled paraphrases from the families above.
family('heldout-web', [
  'Verify the current ferry departure time on the operator\'s website.',
  'Find the official recall notice for this appliance online.',
  'Research the published entry requirements for next month\'s exhibition.',
  'Check online whether the park currently has a closure notice.',
], true, [], [P], false, 'evaluation')
family('heldout-host', [
  'Search the hard drive for the missing audio transcript.',
  'Inspect the service journal to identify why the database is offline.',
  'Package the completed site files into a ZIP on the desktop.',
  'Convert the saved JSON measurements into an HTML report.',
], true, [], [P], false, 'evaluation')
family('heldout-development', [
  'Implement a searchable catalogue for the local book database.',
  'Repair the project\'s failing import command and verify the fix.',
  'Run a benchmark using the script already present in the repository.',
  'Build and test a utility for validating the stored inventory records.',
], true, [], [P], false, 'evaluation')
family('heldout-local', [
  'Make a silly limerick about a teapot.',
  'What is meant by browsing a website?',
  'Talk me through what a backup is, without accessing my files.',
  'Imagine a character named Codex and describe its hat.',
], false, [], [P], false, 'evaluation')
family('heldout-ambiguity', [
  'Can you fix it?', 'Please look that up.', 'Make one for me.', 'Can you create the thing I am thinking of?',
], false, [], [P, H], false, 'evaluation')
family('heldout-context', [
  'Look up what you remember about my violin lessons.',
  'Search your saved memories for the picnic arrangement.',
  'Retrieve our remembered agreement about the greenhouse.',
  'Find the stored memory of my preferred tea.',
], false, [], [M], false, 'evaluation')
addCase('intent', 'tools-heldout-explicit-silence', [
  'A silent nod is all I want from you.',
  'Please take a seat, but keep your voice off for this request.',
  'Bow once; I do not want an announcement or an explanation.',
  'Make the wave gesture without any verbal acknowledgment.',
], [], { needsResponse: false, needsAction: true, needsToolUse: false,
  taskContext: [E], conversationContext: [] }, {}, 'evaluation')
