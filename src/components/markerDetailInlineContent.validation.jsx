import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  GroupedMarkerDetails,
  NearbyMarkerDetails,
} from './MarkerDetails';
import { MarkerDetailInlineContent } from './MarkerDetailInlineRenderer';
import { prepareMarkerDetailInlineContent } from './markerDetailInlineContent';

const rootElement = document.getElementById('validation-root');
const root = createRoot(rootElement);

runValidation().then(() => {
  globalThis.__markerDetailInlineValidationResult = { status: 'passed' };
}).catch((error) => {
  globalThis.__markerDetailInlineValidationResult = {
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
  };
});

async function runValidation() {
  await validateLinkAndBrokenImageBehavior();
  await validateNearbyLazyMounting();
  await validateGroupedLazyMounting('grouped');
  await validateGroupedLazyMounting('representative');
  root.unmount();
}

// TODO: In desktop/markerDetailInlineContentValidation.cjs, register Electron
// session.webRequest.onBeforeSendHeaders for local test images. In this file,
// give nearby, grouped, and representative rows unique URLs such as
// /point-images/castle.png?case=<case-name>. Before expansion, assert each URL is
// absent from performance resource entries; after expansion, assert it appears.
// Before the Electron runner reports success, inspect captured header names
// case-insensitively and assert no image request contains Referer. Keep every
// request on the local Vite server so this validation never contacts third parties.
/** Validate browser link protections, image privacy, and failure fallback. */
async function validateLinkAndBrokenImageBehavior() {
  const localLinkUrl = new URL(
    '/__marker-detail-validation__/page',
    globalThis.location.href,
  ).href;
  const missingImageUrl = new URL(
    '/__marker-detail-validation__/broken.jpg',
    globalThis.location.href,
  ).href;
  const rawImage = `![Broken image](${missingImageUrl})`;
  const tokens = prepareMarkerDetailInlineContent(
    `[Read more](${localLinkUrl}) ${rawImage}`,
  );
  root.render(<MarkerDetailInlineContent tokens={tokens} />);

  await waitFor(
    () => rootElement.querySelector('a') && rootElement.querySelector('img'),
    'link and image to mount',
  );
  const link = rootElement.querySelector('a');
  const image = rootElement.querySelector('img');
  assert(link.target === '_blank', 'Browser links must open a new tab.');
  assert(link.rel === 'noopener noreferrer', 'Browser links need opener protections.');
  assert(image.alt === 'Broken image', 'Image descriptions must become alt text.');
  assert(image.referrerPolicy === 'no-referrer', 'Images must suppress the page referrer.');
  assert(image.closest('a') == null, 'Loaded images must not be clickable.');

  image.dispatchEvent(new Event('error'));
  await waitFor(() => !rootElement.querySelector('img'), 'broken-image fallback');
  assert(rootElement.textContent.includes(rawImage), 'Broken images must restore their markup.');
}

/** Verify a collapsed nearby entry does not mount its inline field content. */
async function validateNearbyLazyMounting() {
  const firstUrl = new URL('/nearby/first', globalThis.location.href).href;
  const secondUrl = new URL('/nearby/second', globalThis.location.href).href;
  root.render(
    <NearbyMarkerDetails
      points={[
        {
          id: 'nearby-first',
          lat: 1,
          lon: 2,
          row: { note: `[First nearby](${firstUrl})` },
        },
        {
          id: 'nearby-second',
          lat: 3,
          lon: 4,
          row: { note: `[Second nearby](${secondUrl})` },
        },
      ]}
    />,
  );

  await waitFor(
    () => rootElement.textContent.includes('First nearby'),
    'first nearby entry content',
  );
  assert(
    !rootElement.textContent.includes('Second nearby'),
    'Collapsed nearby content mounted before expansion.',
  );

  const nearbyEntries = rootElement.querySelectorAll('details');
  nearbyEntries[1].open = true;
  nearbyEntries[1].dispatchEvent(new Event('toggle'));
  await waitFor(
    () => rootElement.textContent.includes('Second nearby'),
    'expanded nearby entry content',
  );
}

/** Verify grouped and representative source rows mount content only on expansion. */
async function validateGroupedLazyMounting(renderType) {
  const label = renderType === 'representative'
    ? 'Representative row content'
    : 'Grouped row content';
  const getGroupRows = () => Promise.resolve({
    rows: [{
      note: `[${label}](${new URL(
        `/grouped/${renderType}`,
        globalThis.location.href,
      ).href})`,
    }],
    totalRows: 1,
  });
  root.render(
    <GroupedMarkerDetails
      key={renderType}
      point={{
        id: `${renderType}-marker`,
        lat: 1,
        lon: 2,
        count: 2,
        renderType,
        groupRef: { queryId: `${renderType}-query` },
      }}
      getGroupRows={getGroupRows}
      isActive
    />,
  );

  const heading = renderType === 'representative'
    ? 'Representative marker'
    : 'Grouped markers';
  await waitFor(
    () => rootElement.textContent.includes(heading) &&
      rootElement.textContent.includes('Row 1'),
    `${renderType} rows`,
  );
  assert(
    !rootElement.textContent.includes(label),
    `${renderType} content mounted before row expansion.`,
  );

  const rowDisclosure = Array.from(rootElement.querySelectorAll('details'))
    .find((details) => details.textContent.includes('Row 1'));
  rowDisclosure.open = true;
  rowDisclosure.dispatchEvent(new Event('toggle'));
  await waitFor(
    () => rootElement.textContent.includes(label),
    `expanded ${renderType} row content`,
  );
}

async function waitFor(predicate, description, timeoutMs = 2000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
