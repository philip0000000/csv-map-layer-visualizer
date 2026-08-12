import { Fragment, useState } from 'react';

/** Render prevalidated inline tokens without enabling HTML or general Markdown. */
export function MarkerDetailInlineContent({ tokens }) {
  return tokens.map((token, index) => {
    const key = `${token.type}:${token.raw ?? token.text}:${index}`;

    if (token.type === 'link') {
      return (
        <a
          key={key}
          className='markerDetailInlineLink'
          href={token.url}
          target='_blank'
          rel='noopener noreferrer'
        >
          {token.text}
        </a>
      );
    }

    if (token.type === 'image') {
      return <MarkerDetailInlineImage key={key} token={token} />;
    }

    return <Fragment key={key}>{token.text}</Fragment>;
  });
}

/** Replace a failed image with its complete original markup as plain text. */
export function MarkerDetailInlineImage({ token }) {
  const [failed, setFailed] = useState(false);

  if (failed) return token.raw;

  return (
    <img
      className='markerDetailInlineImage'
      src={token.url}
      alt={token.text}
      referrerPolicy='no-referrer'
      onError={() => setFailed(true)}
    />
  );
}
