import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import {
  createInlineImageBudget,
  getSafeHttpUrl,
  isSafeAppRelativeImagePath,
  parseMarkerDetailInlineContent,
  prepareMarkerDetailInlineContent,
  resolveMarkerDetailImageUrl,
} from './markerDetailInlineContent.js';

const mixed = [
  'Before ',
  '![Map](https://localhost/map.jpg)',
  ' between ',
  '[Read more](https://localhost/page)',
  ' after',
].join('');
assert.deepEqual(
  parseMarkerDetailInlineContent(mixed).map((token) => token.type),
  ['text', 'image', 'text', 'link', 'text'],
);
assert.equal(
  parseMarkerDetailInlineContent(mixed).map(tokenText).join(''),
  mixed,
);

const parenthesizedTargets = [
  '[Reference](https://localhost/wiki/Function_(mathematics))',
  '![Diagram](https://localhost/images/plot_(final).png)',
];
for (const value of parenthesizedTargets) {
  const [token] = prepareMarkerDetailInlineContent(value);
  assert.equal(token.raw, value);
  assert.equal(token.url.endsWith(token.target), true);
}

for (const plainText of [
  'Some information [in brackets].',
  'Some information (in parentheses).',
  '[Text] (https://localhost)',
  '<img src="https://localhost/not-rendered.jpg">',
]) {
  assert.deepEqual(parseMarkerDetailInlineContent(plainText), [
    { type: 'text', text: plainText },
  ]);
}

assert.deepEqual(
  parseMarkerDetailInlineContent(
    String.raw`\[Link](https://localhost) and \![Image](https://localhost/a.jpg)`,
  ),
  [{
    type: 'text',
    text: '[Link](https://localhost) and ![Image](https://localhost/a.jpg)',
  }],
);

assert.equal(getSafeHttpUrl('https://localhost/page'), 'https://localhost/page');
assert.equal(getSafeHttpUrl('http://127.0.0.1/page'), 'http://127.0.0.1/page');
for (const target of [
  'javascript:alert(1)',
  'data:text/plain,unsafe',
  '/relative',
  'https://localhost/space here',
  ' https://localhost',
  'https://',
]) {
  assert.equal(getSafeHttpUrl(target), null);
}

for (const target of [
  'point-images/castle.jpg',
  './point-images/castle.jpg',
  'folder/nested/image.png?size=large#preview',
]) {
  assert.equal(isSafeAppRelativeImagePath(target), true, target);
}
for (const target of [
  'castle.jpg',
  '/point-images/castle.jpg',
  '../point-images/castle.jpg',
  'point-images/../castle.jpg',
  'point-images/%2e%2e/castle.jpg',
  String.raw`point-images\castle.jpg`,
  'file:point-images/castle.jpg',
]) {
  assert.equal(isSafeAppRelativeImagePath(target), false, target);
}

assert.equal(
  resolveMarkerDetailImageUrl('point-images/castle.jpg', {
    baseUrl: '/',
    locationUrl: 'http://localhost:5173/map',
  }),
  'http://localhost:5173/point-images/castle.jpg',
);
assert.equal(
  resolveMarkerDetailImageUrl('point-images/castle.jpg', {
    baseUrl: '/csv-map-layer-visualizer/',
    locationUrl: 'https://localhost/csv-map-layer-visualizer/',
  }),
  'https://localhost/csv-map-layer-visualizer/point-images/castle.jpg',
);
assert.equal(
  resolveMarkerDetailImageUrl('point-images/castle.jpg', {
    baseUrl: './',
    locationUrl: 'file:///C:/app/dist/index.html',
  }),
  'file:///C:/app/dist/point-images/castle.jpg',
);

for (const markup of [
  '[Unsafe](javascript:alert(1))',
  '![Unsafe](data:image/png;base64,abc)',
  '![Filename](castle.jpg)',
]) {
  assert.deepEqual(
    prepareMarkerDetailInlineContent(markup, {
      locationUrl: 'https://localhost/app/',
    }),
    [{ type: 'text', text: markup }],
  );
}

const imageBudget = createInlineImageBudget();
const preparedFields = Array.from({ length: 11 }, (_, index) => (
  prepareMarkerDetailInlineContent(
    `![Image ${index + 1}](https://localhost/${index + 1}.jpg)`,
    { imageBudget },
  )
));
assert.equal(preparedFields.flat().filter((token) => token.type === 'image').length, 10);
assert.deepEqual(preparedFields[10], [{
  type: 'text',
  text: '![Image 11](https://localhost/11.jpg)',
}]);

const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});
try {
  const { MarkerDetailFieldRows } = await vite.ssrLoadModule(
    '/src/components/MarkerDetails.jsx',
  );
  const markup = renderToStaticMarkup(React.createElement(
    MarkerDetailFieldRows,
    {
      row: {
        content: mixed,
        unsafe: '[Unsafe](javascript:alert(1))',
        html: '<script>alert("no")</script>',
      },
      latField: null,
      lonField: null,
    },
  ));

  assert.match(markup, /class="markerDetailInlineLink"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /class="markerDetailInlineImage"/);
  assert.match(markup, /alt="Map"/);
  assert.match(markup, /referrerPolicy="no-referrer"/);
  assert.match(markup, /\[Unsafe\]\(javascript:alert\(1\)\)/);
  assert.match(markup, /&lt;script&gt;alert\(&quot;no&quot;\)&lt;\/script&gt;/);
} finally {
  await vite.close();
}

console.log('Marker-detail inline-content smoke test passed.');

function tokenText(token) {
  return token.type === 'text' ? token.text : token.raw;
}
