import { useState } from 'react';

interface Props {
  src?: string | null;
  alt: string;
  className?: string;
  eager?: boolean;
}

const PLACEHOLDER = '/images/placeholder.svg';

export function ImageWithFallback({ src, alt, className, eager }: Props) {
  const [failed, setFailed] = useState(false);
  const finalSrc = !src || failed ? PLACEHOLDER : src;
  return (
    <img
      src={finalSrc}
      alt={alt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}
