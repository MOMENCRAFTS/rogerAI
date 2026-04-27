/**
 * TwemojiFlag — renders emoji flags as crisp Twemoji SVGs instead of native OS emoji.
 *
 * Uses the jsDelivr CDN mirror of the Twemoji project.
 * Falls back to the native emoji if the image fails to load.
 */

import { useState } from 'react';

const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/';

/** Convert a flag emoji like 🇺🇸 to its Twemoji SVG URL */
function emojiToTwemojiUrl(emoji: string): string {
  const codepoints = [...emoji]
    .map(c => c.codePointAt(0)!.toString(16))
    .join('-');
  return `${TWEMOJI_BASE}${codepoints}.svg`;
}

interface Props {
  emoji: string;
  size?: number;
  style?: React.CSSProperties;
}

export default function TwemojiFlag({ emoji, size = 24, style }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span style={{ fontSize: size, lineHeight: 1, ...style }}>{emoji}</span>;
  }

  return (
    <img
      src={emojiToTwemojiUrl(emoji)}
      alt={emoji}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        ...style,
      }}
    />
  );
}
