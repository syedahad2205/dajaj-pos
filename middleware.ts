import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { FEATURES, FEATURE_ROUTES } from './lib/features';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  for (const [featureKey, blockedPrefixes] of Object.entries(FEATURE_ROUTES) as [FeatureKey, string[]][]) {
    if (!FEATURES[featureKey]) {
      for (const prefix of blockedPrefixes) {
        if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
          return new NextResponse(null, { status: 404 });
        }
      }
    }
  }

  return NextResponse.next();
}

// Run on all pages except Next.js internals and static assets
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};

type FeatureKey = keyof typeof FEATURES;
