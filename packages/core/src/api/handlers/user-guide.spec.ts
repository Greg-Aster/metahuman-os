import assert from 'node:assert/strict';
import {
  handleGetUserGuideChapter,
  handleListUserGuide,
  handleSearchUserGuide,
  parseMarkdown,
} from './user-guide.js';
import type { UnifiedRequest } from '../types.js';

const rendered = parseMarkdown(`# Sample

- a wrapped list item
  remains inside the item
- a second item

1. first step
2. second step

\`\`\`bash
first command
second command
\`\`\`

| Name | Value |
| --- | --- |
| Alpha | One |

[safe link](https://example.com/a_b)
[unsafe link](javascript:alert(1))
<script>alert('unsafe')</script>`);

assert.match(rendered, /<ul><li>a wrapped list item remains inside the item<\/li><li>a second item<\/li><\/ul>/);
assert.match(rendered, /<ol><li>first step<\/li><li>second step<\/li><\/ol>/);
assert.match(rendered, /<pre><code class="language-bash">first command\nsecond command<\/code><\/pre>/);
assert.match(rendered, /<table><thead><tr><th>Name<\/th><th>Value<\/th><\/tr><\/thead><tbody><tr><td>Alpha<\/td><td>One<\/td><\/tr><\/tbody><\/table>/);
assert.match(rendered, /<a href="https:\/\/example\.com\/a_b">safe link<\/a>/);
assert.doesNotMatch(rendered, /href="javascript:/);
for (const codeBlock of rendered.match(/<pre>[\s\S]*?<\/pre>/g) || []) {
  assert.doesNotMatch(codeBlock, /<p>/);
}
assert.doesNotMatch(rendered, /<script>/);
assert.match(rendered, /&lt;script&gt;/);

const user = {
  userId: 'user-guide-test',
  username: 'user-guide-test',
  role: 'owner' as const,
  isAuthenticated: true,
};
const request: UnifiedRequest = {
  path: '/api/user-guide',
  method: 'GET',
  user,
};

const list = await handleListUserGuide(request);
assert.equal(list.status, 200);
assert.equal(list.data?.totalChapters, 32);

const chapterIds = list.data?.categories.flatMap((category: { chapters: Array<{ id: string }> }) =>
  category.chapters.map((chapter) => chapter.id),
) as string[];
assert.equal(new Set(chapterIds).size, 32);
assert.equal(chapterIds[0], '01-overview');
assert.equal(chapterIds.at(-1), '22-ethical-use-policy');

const listedChapters = list.data?.categories.flatMap(
  (category: { chapters: Array<{ id: string; title: string }> }) => category.chapters,
) as Array<{ id: string; title: string }>;
assert.equal(listedChapters.find((chapter) => chapter.id === 'ai-training')?.title, 'AI Training');
assert.equal(listedChapters.find((chapter) => chapter.id === 'llm-backend')?.title, 'LLM Backend Configuration');
assert.equal(listedChapters.find((chapter) => chapter.id === 'faq')?.title, 'Frequently Asked Questions');

for (const id of chapterIds) {
  const chapter = await handleGetUserGuideChapter({
    ...request,
    path: `/api/user-guide/${id}`,
    params: { id },
  });
  assert.equal(chapter.status, 200, id);
  assert.match(chapter.data?.chapter.content, /<h1>/, id);
  for (const codeBlock of chapter.data?.chapter.content.match(/<pre>[\s\S]*?<\/pre>/g) || []) {
    assert.doesNotMatch(codeBlock, /<p>/, id);
  }
}

const voiceTraining = await handleGetUserGuideChapter({
  ...request,
  params: { id: 'voice-training' },
});
assert.equal(voiceTraining.data?.prev?.id, 'persona-generator');
assert.equal(voiceTraining.data?.next?.id, 'agency-system');

const missing = await handleGetUserGuideChapter({
  ...request,
  params: { id: 'not-a-real-chapter' },
});
assert.equal(missing.status, 404);

const search = await handleSearchUserGuide({
  ...request,
  path: '/api/user-guide/search',
  query: { q: 'environment action selector' },
});
assert.equal(search.status, 200);
assert.ok(search.data?.total > 0);

console.log('user-guide.spec.ts passed');
