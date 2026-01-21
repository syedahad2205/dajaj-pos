# DAJAJ POS System

A simple web-based Point of Sale system for DAJAJ restaurant built with Next.js, Firebase, and Tailwind CSS.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Firebase Setup

1. Create an admin user in Firebase Authentication:
   - Go to Firebase Console → Authentication → Users
   - Add a user with email/password

2. Set up Firestore Security Rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

3. Create the counters collection:
   - Go to Firestore → Create Collection: `counters`
   - Create Document with ID: `bills`
   - Add field: `current` (number) = 0

## Features

- Email/password authentication
- Menu grid with categories
- Item selection with variants and add-ons
- Cart management
- Bill generation with auto-incrementing bill numbers
- PDF generation (on-demand, never stored)
- WhatsApp sharing
- Tax breakdown (CGST/SGST) - prices are final, tax included

## Deployment

Deploy to Vercel:
```bash
npm run build
vercel deploy
```

Make sure to set up Firebase environment variables if needed (though config is hardcoded as specified).

