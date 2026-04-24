'use client';

import Link from 'next/link';
import { trackEvent } from '@/lib/analytics';
import type { CSSProperties, ReactNode } from 'react';

interface LocationLinkProps {
  href: string;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}

export default function LocationLink({ href, className, style, children }: LocationLinkProps) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      onClick={() => {
        void trackEvent('location_click');
      }}
    >
      {children}
    </Link>
  );
}
